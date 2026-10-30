// 한글 파일(.hwp / .hwpx)에서 문단 글자를 순서대로 꺼낸다. 표의 칸 하나하나가 문단 하나가 된다.
// .hwp  : OLE 복합 문서 안의 BodyText/SectionN 스트림(raw deflate 압축된 레코드)에서 PARA_TEXT(태그 67)를 읽는다.
// .hwpx : zip 안의 Contents/sectionN.xml 에서 <hp:p> 마다 <hp:t> 글자를 모은다.
// 결과는 빈 칸을 뺀 글자 목록(string[]).
(function () {
  // 한글 스트림은 압축 데이터 뒤에 남는 바이트가 있어 브라우저가 끝에서 오류를 낸다.
  // 그 전까지 풀린 내용은 온전하므로 조각을 모아 두고 끝의 오류는 무시한다.
  async function inflateRaw(bytes) {
    const ds = new DecompressionStream("deflate-raw");
    const writer = ds.writable.getWriter();
    writer.write(bytes).catch(() => {});
    writer.close().catch(() => {});
    const reader = ds.readable.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
      }
    } catch (err) {
      if (!total) throw err;
    }
    const out = new Uint8Array(total);
    let p = 0;
    chunks.forEach((c) => { out.set(c, p); p += c.length; });
    return out;
  }

  // ---------- OLE 복합 문서 ----------
  function readCfb(buf) {
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0xe011cfd0) throw new Error("한글(.hwp) 파일이 아닙니다.");
    const secSize = 1 << dv.getUint16(0x1e, true);
    const miniSize = 1 << dv.getUint16(0x20, true);
    const dirStart = dv.getUint32(0x30, true);
    const cutoff = dv.getUint32(0x38, true);
    const miniFatStart = dv.getUint32(0x3c, true);
    const difatStart = dv.getUint32(0x44, true);
    const off = (s) => (s + 1) * secSize;
    const END = 0xfffffffe;

    const fatSectors = [];
    for (let i = 0; i < 109; i++) {
      const s = dv.getUint32(0x4c + i * 4, true);
      if (s < END) fatSectors.push(s);
    }
    for (let s = difatStart, guard = 0; s < END && guard < 10000; guard++) {
      const per = secSize / 4 - 1;
      for (let i = 0; i < per; i++) {
        const v = dv.getUint32(off(s) + i * 4, true);
        if (v < END) fatSectors.push(v);
      }
      s = dv.getUint32(off(s) + per * 4, true);
    }
    const fat = [];
    fatSectors.forEach((s) => { for (let i = 0; i < secSize / 4; i++) fat.push(dv.getUint32(off(s) + i * 4, true)); });

    const chain = (start, table) => {
      const out = [];
      for (let s = start; s < END && out.length <= table.length; s = table[s]) out.push(s);
      return out;
    };
    const readChain = (start) => {
      const secs = chain(start, fat);
      const bytes = new Uint8Array(secs.length * secSize);
      secs.forEach((s, i) => bytes.set(new Uint8Array(buf, off(s), Math.min(secSize, buf.byteLength - off(s))), i * secSize));
      return bytes;
    };

    const dirBytes = readChain(dirStart);
    const entries = [];
    for (let p = 0; p + 128 <= dirBytes.length; p += 128) {
      const e = new DataView(dirBytes.buffer, p, 128);
      const nameLen = e.getUint16(0x40, true);
      let name = "";
      for (let i = 0; i + 2 < nameLen; i += 2) name += String.fromCharCode(e.getUint16(i, true));
      entries.push({ name, type: e.getUint8(0x42), start: e.getUint32(0x74, true), size: e.getUint32(0x78, true) });
    }
    const root = entries[0];
    const miniStream = readChain(root.start);
    const miniFat = [];
    if (miniFatStart < END) {
      const mf = readChain(miniFatStart);
      const mdv = new DataView(mf.buffer);
      for (let i = 0; i < mf.length / 4; i++) miniFat.push(mdv.getUint32(i * 4, true));
    }

    const read = (entry) => {
      if (entry.size < cutoff) {
        const secs = chain(entry.start, miniFat);
        const bytes = new Uint8Array(secs.length * miniSize);
        secs.forEach((s, i) => bytes.set(miniStream.subarray(s * miniSize, (s + 1) * miniSize), i * miniSize));
        return bytes.subarray(0, entry.size);
      }
      return readChain(entry.start).subarray(0, entry.size);
    };
    return { entries: entries.filter((e) => e.type === 2), read };
  }

  function paraText(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let out = "";
    for (let i = 0; i + 1 < bytes.length;) {
      const c = dv.getUint16(i, true);
      if (c < 32) {
        // 0,10,13,24~31: 글자 하나 크기 제어 / 그 밖: 8글자(16바이트) 크기 제어
        if (c === 0 || c === 10 || c === 13 || c >= 24) { if (c === 10 || c === 13) out += " "; i += 2; }
        else i += 16;
        continue;
      }
      out += String.fromCharCode(c);
      i += 2;
    }
    return out;
  }

  async function hwpTokens(buf) {
    const { entries, read } = readCfb(buf);
    const header = entries.find((e) => e.name === "FileHeader");
    if (!header) throw new Error("한글 파일 머리 정보를 찾지 못했습니다.");
    const flags = new DataView(read(header).buffer).getUint32(36, true);
    if (flags & 2) throw new Error("암호가 걸린 한글 파일입니다. 암호를 풀고 다시 저장해 주세요.");
    if (flags & 4) throw new Error("배포용 문서라 읽을 수 없습니다. 일반 문서로 저장해 주세요.");
    const sections = entries.filter((e) => /^Section\d+$/.test(e.name)).sort((a, b) => +a.name.slice(7) - +b.name.slice(7));
    const tokens = [];
    for (const sec of sections) {
      let data = read(sec);
      if (flags & 1) data = await inflateRaw(data);
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      for (let i = 0; i + 4 <= data.length;) {
        const h = dv.getUint32(i, true);
        i += 4;
        const tag = h & 0x3ff;
        let size = h >>> 20;
        if (size === 0xfff) { size = dv.getUint32(i, true); i += 4; }
        if (tag === 67) {
          const t = paraText(data.subarray(i, i + size)).trim();
          if (t) tokens.push(t);
        }
        i += size;
      }
    }
    return tokens;
  }

  // ---------- zip(.hwpx) ----------
  async function hwpxTokens(buf) {
    const dv = new DataView(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("한글(.hwpx) 파일이 아닙니다.");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = [];
    for (let n = 0; n < count; n++) {
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extra = dv.getUint16(p + 30, true);
      const comment = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nameLen));
      files.push({ name, method, csize, local });
      p += 46 + nameLen + extra + comment;
    }
    const sections = files.filter((f) => /^Contents\/section\d+\.xml$/i.test(f.name))
      .sort((a, b) => +a.name.match(/\d+/)[0] - +b.name.match(/\d+/)[0]);
    const tokens = [];
    for (const f of sections) {
      const start = f.local + 30 + dv.getUint16(f.local + 26, true) + dv.getUint16(f.local + 28, true);
      const raw = new Uint8Array(buf, start, f.csize);
      const xml = new TextDecoder().decode(f.method === 8 ? await inflateRaw(raw) : raw);
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      const paras = [...doc.getElementsByTagName("*")].filter((el) => el.localName === "p");
      paras.forEach((para) => {
        // 표 안의 문단은 바깥 문단 안에 들어 있으므로, 표를 품은 문단은 건너뛴다.
        if ([...para.getElementsByTagName("*")].some((el) => el.localName === "tbl")) return;
        const t = [...para.getElementsByTagName("*")].filter((el) => el.localName === "t").map((el) => el.textContent).join("").trim();
        if (t) tokens.push(t);
      });
    }
    return tokens;
  }

  async function readHwpTokens(file) {
    const buf = await file.arrayBuffer();
    const head = new Uint8Array(buf, 0, 4);
    if (head[0] === 0x50 && head[1] === 0x4b) return hwpxTokens(buf);
    return hwpTokens(buf);
  }

  window.GWHwp = { readHwpTokens, hwpTokens };
})();
