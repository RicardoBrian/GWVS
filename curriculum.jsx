// 교육과정 내 봉사: 학급 명단(담임 업로드) · 출결 체크(담임) · 활동 관리와 현황판(관리자) · 확인서 출력
// 전교생이 참여하고, 관리자가 정한 날짜·교시에 없었던 학생만 빠진다. 참여하면 활동의 인정 시간 전부, 빠지면 0시간.
(function () {
  const { useState, useMemo, useEffect, useRef } = React;
  const { db, FieldValue, PATHS, AREAS, GRADES, PERIODS, toInt, classKey, classLabel, rosterId, attendanceId,
    byGradeClassNo, todayKey, fmtDate, fmtPeriods, fmtTime, readTextFile, downloadCsv, commitInChunks, toast,
    useWide, useCollection, Icon, Modal, Inspector, PageHead, Empty, Stat, MoreMenu, Seg, GradeClassSelect } = window.GW;

  const eventGrades = (e) => (e.grades && e.grades.length ? e.grades : GRADES);
  const eventLine = (e) => [fmtDate(e.date), fmtPeriods(e), `${e.hours}시간`].filter(Boolean).join(" · ");
  const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

  // 학급 목록: 명단에 있는 학급 + 추가로 넘겨받은 학급 키
  function classesOf(roster, grades, extraKeys = []) {
    const m = new Map();
    roster.forEach((s) => { if (!grades || grades.includes(s.grade)) m.set(classKey(s.grade, s.klass), { grade: s.grade, klass: s.klass }); });
    extraKeys.forEach((k) => {
      const [g, c] = k.split("-").map(Number);
      if (g && c && (!grades || grades.includes(g))) m.set(k, { grade: g, klass: c });
    });
    return [...m.values()].sort(byGradeClassNo);
  }

  // 활동 하나의 학급별 결과. 마감된 활동은 마감할 때 고정한 명단을 쓴다.
  function classResults(event, roster, attByKey, teacherByClass) {
    if (event.finalized && event.snapshot) {
      return Object.values(event.snapshot).map((r) => ({
        ...r,
        key: classKey(r.grade, r.klass),
        participants: (r.participants || []).map((s) => ({ ...s, grade: r.grade, klass: r.klass })),
        absent: (r.absent || []).map((s) => ({ ...s, grade: r.grade, klass: r.klass })),
        hasRoster: true,
      })).sort(byGradeClassNo);
    }
    const grades = eventGrades(event);
    const keys = [...Object.keys(attByKey), ...Object.keys(teacherByClass)];
    return classesOf(roster, grades, keys).map(({ grade, klass }) => {
      const key = classKey(grade, klass);
      const students = roster.filter((s) => s.grade === grade && s.klass === klass).sort(byGradeClassNo);
      const att = attByKey[key];
      const off = new Set(att ? att.absent || [] : []);
      return {
        key, grade, klass,
        teacher: teacherByClass[key] || "",
        confirmed: !!(att && att.confirmed),
        confirmedBy: att ? att.confirmedBy || "" : "",
        confirmedAt: att ? att.confirmedAt : null,
        participants: students.filter((s) => !off.has(s.id)),
        absent: students.filter((s) => off.has(s.id)),
        hasRoster: students.length > 0,
      };
    });
  }

  function useAttendanceFor(eventId) {
    const [items, setItems] = useState(null);
    useEffect(() => {
      if (!eventId) { setItems(null); return; }
      return db.collection(PATHS.attendance).where("eventId", "==", eventId).onSnapshot(
        (snap) => setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        (err) => { console.error(err); setItems([]); }
      );
    }, [eventId]);
    return useMemo(() => Object.fromEntries((items || []).map((a) => [classKey(a.grade, a.klass), a])), [items]);
  }

  // ============================================================
  // 명단 붙여넣기·CSV 읽기
  // 나이스 학생 명부를 엑셀에서 복사해 붙여넣거나 CSV로 저장한 파일을 받는다.
  // 머리줄(번호·성명)이 있으면 그 열을 쓰고, 없으면 "숫자 칸 = 번호, 그다음 글자 칸 = 이름"으로 읽는다.
  // ============================================================
  function parseRoster(text) {
    const rows = Papa.parse(String(text || "").trim(), { skipEmptyLines: true }).data
      .map((r) => r.map((c) => String(c ?? "").trim()));
    const isNum = (v) => /^\d+$/.test(v);
    let start = 0;
    let col = null;
    for (let i = 0; i < Math.min(rows.length, 8); i++) {
      const r = rows[i].map((c) => c.replace(/\s/g, ""));
      const num = r.findIndex((c) => c === "번호" || c === "출석번호" || c === "번");
      const name = r.findIndex((c) => /^(성명|이름|학생명|한글성명|학생성명)$/.test(c));
      if (num >= 0 && name >= 0) {
        col = { num, name, grade: r.findIndex((c) => c === "학년"), klass: r.findIndex((c) => c === "반" || c === "학급") };
        start = i + 1;
        break;
      }
    }
    const out = [];
    rows.slice(start).forEach((r) => {
      let number, name, grade = null, klass = null;
      if (col) {
        number = toInt(r[col.num]);
        name = (r[col.name] || "").trim();
        if (col.grade >= 0) grade = toInt(r[col.grade]);
        if (col.klass >= 0) klass = toInt(r[col.klass]);
      } else {
        const cells = r.filter((c) => c !== "");
        if (cells.length >= 4 && isNum(cells[0]) && isNum(cells[1]) && isNum(cells[2]) && !isNum(cells[3])) {
          [grade, klass, number, name] = [toInt(cells[0]), toInt(cells[1]), toInt(cells[2]), cells[3]];
        } else {
          const ni = cells.findIndex(isNum);
          if (ni < 0) return;
          number = toInt(cells[ni]);
          name = (cells.slice(ni + 1).find((c) => !isNum(c) && !/^[남여]$/.test(c)) || "").trim();
        }
      }
      if (number && name) out.push({ grade, klass, number, name });
    });
    return { rows: out, hasClassCols: out.some((r) => r.grade && r.klass) };
  }

  async function replaceClassRoster(roster, grade, klass, rows) {
    const col = db.collection(PATHS.roster);
    const keep = new Set(rows.map((r) => rosterId(grade, klass, r.number)));
    const old = roster.filter((s) => s.grade === grade && s.klass === klass && !keep.has(s.id));
    await commitInChunks([
      ...old.map((s) => (b) => b.delete(col.doc(s.id))),
      ...rows.map((r) => (b) => b.set(col.doc(rosterId(grade, klass, r.number)), {
        grade, klass, number: r.number, name: r.name, updatedAt: FieldValue.serverTimestamp(),
      })),
    ]);
  }

  // ============================================================
  // 학급 명단
  // ============================================================
  function RosterPage({ isAdmin, homeroom, roster, route, go }) {
    const initial = route.cls ? route.cls.split("-").map(Number) : homeroom ? [homeroom.grade, homeroom.klass] : [];
    const [grade, setGrade] = useState(initial[0] || (roster && roster[0] ? roster[0].grade : 1));
    const [klass, setKlass] = useState(initial[1] || (roster && roster[0] ? roster[0].klass : 1));
    const [paste, setPaste] = useState("");
    const [preview, setPreview] = useState(null);
    const [editing, setEditing] = useState(null);
    const [addNo, setAddNo] = useState("");
    const [addName, setAddName] = useState("");
    const list = roster || [];
    const locked = !isAdmin;
    const g = locked ? homeroom.grade : grade;
    const k = locked ? homeroom.klass : klass;
    const students = useMemo(() => list.filter((s) => s.grade === g && s.klass === k).sort(byGradeClassNo), [list, g, k]);
    const allClasses = useMemo(() => classesOf(list), [list]);

    const pick = (ng, nk) => { setGrade(ng); setKlass(nk); go(`#roster/${ng}-${nk}`); };

    const openPreview = (text, source) => {
      const parsed = parseRoster(text);
      if (!parsed.rows.length) return toast("번호와 이름을 찾지 못했습니다. 번호·이름 열을 함께 복사했는지 확인하세요.", "danger");
      setPreview({ ...parsed, source });
    };
    const onFile = async (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (file) openPreview(await readTextFile(file), file.name);
    };

    const addOne = async (e) => {
      e.preventDefault();
      const n = toInt(addNo);
      if (!n || !addName.trim()) return toast("번호와 이름을 입력하세요.", "danger");
      if (students.some((s) => s.number === n)) return toast(`${n}번은 이미 있습니다.`, "danger");
      await db.collection(PATHS.roster).doc(rosterId(g, k, n)).set({ grade: g, klass: k, number: n, name: addName.trim(), updatedAt: FieldValue.serverTimestamp() });
      setAddNo("");
      setAddName("");
      toast(`${n}번 ${addName.trim()} 학생을 추가했습니다.`);
    };

    const byGrade = GRADES.map((gr) => [gr, allClasses.filter((c) => c.grade === gr)]).filter(([, cs]) => cs.length);

    return (
      <>
        <PageHead
          title="학급 명단"
          sub={locked ? `${classLabel(g, k)} · ${students.length}명` : `전교생 ${list.length}명 · ${allClasses.length}개 학급`}
          actions={isAdmin && (
            <div style={{ width: "13rem" }}>
              <GradeClassSelect grade={grade} klass={klass} classes={allClasses} onChange={(ng, nk) => ng && nk ? pick(ng, nk) : (setGrade(ng), setKlass(nk))} />
            </div>
          )}
        />

        {isAdmin && byGrade.length > 0 && (
          <div className="card card-pad" style={{ marginBottom: "1.125rem" }}>
            <div className="grid gap-3">
              {byGrade.map(([gr, cs]) => (
                <div key={gr} className="flex flex-wrap items-center gap-2">
                  <span className="section-label" style={{ width: "2.75rem" }}>{gr}학년</span>
                  {cs.map((c) => {
                    const n = list.filter((s) => s.grade === c.grade && s.klass === c.klass).length;
                    const on = c.grade === g && c.klass === k;
                    return (
                      <button key={c.klass} onClick={() => pick(c.grade, c.klass)} className="btn btn-sm" aria-pressed={on}>
                        {c.klass}반 <span className="num" style={{ opacity: 0.7 }}>{n}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="split">
          <div className="card" style={{ overflow: "hidden" }}>
            <div className="card-head">
              <span className="card-title">{g && k ? classLabel(g, k) : "학급을 고르세요"}</span>
              <span className="muted num" style={{ fontSize: "0.8125rem" }}>{students.length}명</span>
              <span className="faint ml-auto hidden sm:inline" style={{ fontSize: "0.8rem" }}>줄을 누르면 고치거나 뺄 수 있습니다.</span>
            </div>
            {roster === null ? <Empty title="불러오는 중…" /> : students.length === 0 ? (
              <Empty title="아직 명단이 없습니다." sub="나이스 학생 명부에서 번호·이름 열을 복사해 붙여넣거나 CSV 파일을 올리세요." />
            ) : (
              <div className="roster-cols">
                {students.map((s) => (
                  <button key={s.id} className="roster-row row-open" onClick={() => setEditing(s)}>
                    <span className="num faint" style={{ width: "2rem" }}>{s.number}</span>
                    <span className="font-semibold">{s.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="side stack">
            <div className="card card-pad">
              <div className="card-title" style={{ marginBottom: "0.75rem" }}>명단 올리기</div>
              <textarea className="inp" rows="6" value={paste} onChange={(e) => setPaste(e.target.value)}
                placeholder={"나이스 학생 명부(엑셀)에서 번호·성명 열을 복사해 붙여넣으세요.\n\n1\t김하늘\n2\t이도윤"} />
              <div className="flex gap-2 mt-2">
                <button className="btn btn-primary" disabled={!paste.trim()} onClick={() => openPreview(paste, "붙여넣기")}>확인</button>
                <label className="btn">
                  <Icon name="upload" size={16} />CSV 파일
                  <input type="file" accept=".csv,.txt" className="hidden" onChange={onFile} />
                </label>
              </div>
              <p className="field-hint">올리면 {g && k ? classLabel(g, k) : "이 학급"} 명단이 통째로 바뀝니다. 미리보기에서 확인한 뒤 저장됩니다.</p>
            </div>
            <form className="card card-pad" onSubmit={addOne}>
              <div className="card-title" style={{ marginBottom: "0.75rem" }}>한 명 추가 (전입 등)</div>
              <div className="grid gap-2" style={{ gridTemplateColumns: "5rem 1fr auto" }}>
                <input className="inp num" type="number" min="1" placeholder="번호" value={addNo} onChange={(e) => setAddNo(e.target.value)} aria-label="번호" />
                <input className="inp" placeholder="이름" value={addName} onChange={(e) => setAddName(e.target.value)} aria-label="이름" />
                <button className="btn" type="submit" disabled={!g || !k}>추가</button>
              </div>
            </form>
          </div>
        </div>

        {preview && (
          <RosterPreview preview={preview} isAdmin={isAdmin} grade={g} klass={k} roster={list}
            onClose={() => setPreview(null)} onSaved={() => { setPreview(null); setPaste(""); }} />
        )}
        {editing && <RosterEdit s={editing} students={students} onClose={() => setEditing(null)} />}
      </>
    );
  }

  function RosterPreview({ preview, isAdmin, grade, klass, roster, onClose, onSaved }) {
    // 학년·반 열이 있는 파일을 관리자가 올리면 파일에 적힌 학급마다 저장할 수 있다.
    const multi = isAdmin && preview.hasClassCols;
    const [mode, setMode] = useState(multi ? "file" : "this");
    const [busy, setBusy] = useState(false);
    const groups = useMemo(() => {
      if (mode === "file") {
        const m = new Map();
        preview.rows.filter((r) => r.grade && r.klass).forEach((r) => {
          const key = classKey(r.grade, r.klass);
          if (!m.has(key)) m.set(key, { grade: r.grade, klass: r.klass, rows: [] });
          m.get(key).rows.push(r);
        });
        return [...m.values()].sort(byGradeClassNo);
      }
      const own = preview.rows.filter((r) => !r.grade || !r.klass || (r.grade === grade && r.klass === klass));
      return [{ grade, klass, rows: own, skipped: preview.rows.length - own.length }];
    }, [mode, preview, grade, klass]);

    const problems = groups.flatMap((gr) => {
      const seen = new Map();
      gr.rows.forEach((r) => seen.set(r.number, (seen.get(r.number) || 0) + 1));
      return [...seen].filter(([, n]) => n > 1).map(([no]) => `${classLabel(gr.grade, gr.klass)} ${no}번이 두 번 이상 나옵니다.`);
    });
    const skipped = groups[0] && groups[0].skipped;
    const total = groups.reduce((n, gr) => n + gr.rows.length, 0);

    const save = async () => {
      if (problems.length) return;
      const existing = groups.reduce((n, gr) => n + roster.filter((s) => s.grade === gr.grade && s.klass === gr.klass).length, 0);
      if (existing && !window.confirm(`${groups.length}개 학급의 기존 명단 ${existing}명을 이 ${total}명으로 바꿉니다. 계속할까요?`)) return;
      setBusy(true);
      try {
        for (const gr of groups) await replaceClassRoster(roster, gr.grade, gr.klass, gr.rows);
        toast(`${groups.length > 1 ? `${groups.length}개 학급 ` : ""}${total}명을 저장했습니다.`);
        onSaved();
      } catch (err) {
        console.error(err);
        toast("저장하지 못했습니다. 담임 학급이 맞는지 확인하세요.", "danger");
      }
      setBusy(false);
    };

    return (
      <Modal title="명단 미리보기" sub={`${preview.source} · ${preview.rows.length}줄을 읽었습니다.`} onClose={onClose} width={640}
        footer={<>
          <button onClick={onClose} className="btn">취소</button>
          <button onClick={save} disabled={busy || !total || problems.length > 0} className="btn btn-primary">
            {mode === "file" ? `${groups.length}개 학급 저장` : `${classLabel(grade, klass)}에 ${total}명 저장`}
          </button>
        </>}>
        <div className="fields">
          {multi && <Seg value={mode} onChange={setMode} options={[["file", "파일의 학년·반대로 저장"], ["this", `${classLabel(grade, klass)}에만 저장`]]} />}
          {skipped > 0 && <div className="notice notice-warn">다른 학급으로 적힌 {skipped}줄은 빼고 저장합니다.</div>}
          {problems.length > 0 && <div className="notice notice-danger">{problems.map((p) => <div key={p}>{p}</div>)}</div>}
          {groups.map((gr) => (
            <div key={classKey(gr.grade, gr.klass)}>
              {groups.length > 1 && <div className="section-label" style={{ marginBottom: "0.35rem" }}>{classLabel(gr.grade, gr.klass)} · {gr.rows.length}명</div>}
              <div className="roster-cols" style={{ background: "var(--fill)", borderRadius: 12 }}>
                {gr.rows.map((r, i) => (
                  <div key={i} className="roster-row"><span className="num faint" style={{ width: "2rem" }}>{r.number}</span><span>{r.name}</span></div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Modal>
    );
  }

  function RosterEdit({ s, students, onClose }) {
    const [no, setNo] = useState(String(s.number));
    const [name, setName] = useState(s.name);
    const [busy, setBusy] = useState(false);
    const save = async () => {
      const n = toInt(no);
      if (!n || !name.trim()) return toast("번호와 이름을 입력하세요.", "danger");
      if (n !== s.number && students.some((x) => x.number === n)) return toast(`${n}번은 이미 있습니다.`, "danger");
      setBusy(true);
      const col = db.collection(PATHS.roster);
      const data = { grade: s.grade, klass: s.klass, number: n, name: name.trim(), updatedAt: FieldValue.serverTimestamp() };
      if (n === s.number) await col.doc(s.id).set(data);
      else await commitInChunks([(b) => b.delete(col.doc(s.id)), (b) => b.set(col.doc(rosterId(s.grade, s.klass, n)), data)]);
      toast("저장했습니다.");
      onClose();
    };
    const remove = async () => {
      if (!window.confirm(`${s.number}번 ${s.name} 학생을 명단에서 뺄까요? (전출 등)`)) return;
      await db.collection(PATHS.roster).doc(s.id).delete();
      toast("명단에서 뺐습니다.");
      onClose();
    };
    return (
      <Modal title={`${s.number}번 ${s.name}`} sub={classLabel(s.grade, s.klass)} onClose={onClose} width={420}
        footer={<>
          <button onClick={remove} className="btn btn-ghost btn-danger mr-auto">명단에서 빼기</button>
          <button onClick={onClose} className="btn">취소</button>
          <button onClick={save} disabled={busy} className="btn btn-primary">저장</button>
        </>}>
        <div className="grid gap-2" style={{ gridTemplateColumns: "5rem 1fr" }}>
          <div><label className="field-label">번호</label><input className="inp num" type="number" min="1" value={no} onChange={(e) => setNo(e.target.value)} /></div>
          <div><label className="field-label">이름</label><input className="inp" value={name} onChange={(e) => setName(e.target.value)} /></div>
        </div>
        <p className="field-hint">번호를 바꾸면 아직 마감되지 않은 활동의 이 학생 불참 표시는 지워집니다.</p>
      </Modal>
    );
  }

  // ============================================================
  // 출결 체크 (담임: 자기 반 / 관리자: 아무 반)
  // ============================================================
  function pickDefaultEvent(list) {
    if (!list.length) return null;
    const today = todayKey();
    const past = list.filter((e) => e.date <= today);
    return (past[0] || list[list.length - 1]).id; // list는 최근 날짜가 위
  }

  function AttendancePage({ isAdmin, homeroom, me, roster, events, route, go }) {
    const fromRoute = route.cls ? route.cls.split("-").map(Number) : null;
    const g = fromRoute ? fromRoute[0] : homeroom ? homeroom.grade : null;
    const k = fromRoute ? fromRoute[1] : homeroom ? homeroom.klass : null;
    const list = roster || [];
    const allClasses = useMemo(() => classesOf(list), [list]);
    const evs = useMemo(() => (events || []).filter((e) => !g || eventGrades(e).includes(g)), [events, g]);
    const eventId = route.eventId && evs.some((e) => e.id === route.eventId) ? route.eventId : pickDefaultEvent(evs);
    const ev = evs.find((e) => e.id === eventId) || null;
    const students = useMemo(() => list.filter((s) => s.grade === g && s.klass === k).sort(byGradeClassNo), [list, g, k]);

    // 이 학급의 모든 활동 출결 문서(활동 목록에 상태를 보여 주려고)
    const [attDocs, setAttDocs] = useState(null);
    useEffect(() => {
      if (!g || !k) { setAttDocs(null); return; }
      return db.collection(PATHS.attendance).where("grade", "==", g).where("klass", "==", k).onSnapshot(
        (snap) => setAttDocs(Object.fromEntries(snap.docs.map((d) => [d.data().eventId, { id: d.id, ...d.data() }]))),
        (err) => { console.error(err); setAttDocs({}); }
      );
    }, [g, k]);
    const att = attDocs && ev ? attDocs[ev.id] || null : null;
    const saved = useMemo(() => new Set(att ? att.absent || [] : []), [att]);

    const [draft, setDraft] = useState(saved);
    const [busy, setBusy] = useState(false);
    const [certOpen, setCertOpen] = useState(false);
    const dirty = !sameSet(draft, saved);
    // 활동·학급을 바꾸거나, 고치던 중이 아닐 때 저장된 값이 바뀌면(다른 기기에서 저장 등) 화면 값을 다시 맞춘다.
    const draftRef = useRef(draft);
    draftRef.current = draft;
    const prevSaved = useRef(saved);
    const lastKey = useRef("");
    useEffect(() => {
      const key = `${eventId}|${g}-${k}`;
      if (key !== lastKey.current || sameSet(draftRef.current, prevSaved.current)) setDraft(new Set(saved));
      prevSaved.current = saved;
      lastKey.current = key;
    }, [saved, eventId, g, k]);

    const leave = (hash) => {
      if (dirty && !window.confirm("저장하지 않은 출결 변경이 있습니다. 버리고 이동할까요?")) return;
      setDraft(new Set(saved));
      go(hash);
    };
    const toggle = (id) => setDraft((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

    const save = async () => {
      setBusy(true);
      try {
        const ids = new Set(students.map((s) => s.id));
        await db.collection(PATHS.attendance).doc(attendanceId(ev.id, g, k)).set({
          eventId: ev.id, grade: g, klass: k,
          absent: [...draft].filter((id) => ids.has(id)),
          confirmed: true, confirmedBy: me, confirmedAt: FieldValue.serverTimestamp(),
        });
        toast("출결을 확인했습니다.");
      } catch (err) {
        console.error(err);
        toast(ev.finalized ? "마감된 활동이라 바꿀 수 없습니다." : "저장하지 못했습니다.", "danger");
      }
      setBusy(false);
    };

    const head = (
      <PageHead
        title="교육과정 내 출결"
        sub={g && k ? `${classLabel(g, k)} · ${students.length}명` : "학급을 고르세요"}
        actions={isAdmin && (
          <div style={{ width: "13rem" }}>
            <GradeClassSelect grade={g} klass={k} classes={allClasses}
              onChange={(ng, nk) => leave(`#attendance/${eventId || "-"}/${ng || g || 1}-${nk || k || 1}`)} />
          </div>
        )}
      />
    );

    if (!g || !k) return <>{head}<div className="card"><Empty title="출결을 확인할 학급을 위에서 고르세요." /></div></>;
    if (events !== null && !evs.length) return <>{head}<div className="card"><Empty title="등록된 활동이 없습니다." sub="담당 선생님이 활동(날짜·교시)을 등록하면 여기에 나옵니다." /></div></>;

    const off = students.filter((s) => draft.has(s.id)).length;
    const locked = !!(ev && ev.finalized);
    const eventPicker = (
      <div className="event-list">
        {evs.map((e) => {
          const a = attDocs && attDocs[e.id];
          return (
            <button key={e.id} className={`event-item ${e.id === eventId ? "on" : ""}`} onClick={() => e.id !== eventId && leave(`#attendance/${e.id}/${g}-${k}`)}>
              <span className="when">{fmtDate(e.date)} · {fmtPeriods(e)}</span>
              <span className="ttl">{e.title}</span>
              <span className="flex items-center gap-1.5" style={{ fontSize: "0.75rem" }}>
                {e.finalized ? <span className="badge">마감</span> : a && a.confirmed
                  ? <><span className="dot dot-ok" /><span className="muted">확인 · 불참 {(a.absent || []).length}</span></>
                  : <><span className="dot dot-warn" /><span className="muted">미확인</span></>}
              </span>
            </button>
          );
        })}
      </div>
    );

    return (
      <>
        {head}
        <div className="split split-left">
          <div className="panel card card-pad" style={{ padding: "0.75rem" }}>
            <div className="section-label" style={{ padding: "0.25rem 0.25rem 0.5rem" }}>활동</div>
            {eventPicker}
          </div>
          <div className="stack">
            <div className="wide-hide">
              <select className="inp" value={eventId || ""} onChange={(e) => leave(`#attendance/${e.target.value}/${g}-${k}`)} aria-label="활동">
                {evs.map((e) => <option key={e.id} value={e.id}>{fmtDate(e.date)} {fmtPeriods(e)} · {e.title}{e.finalized ? " (마감)" : ""}</option>)}
              </select>
            </div>
            {ev && (
              <div className="card" style={{ overflow: "hidden" }}>
                <div className="card-pad" style={{ paddingBottom: "0.75rem" }}>
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="muted num" style={{ fontSize: "0.8125rem" }}>{eventLine(ev)} · {ev.area}</div>
                      <div style={{ fontSize: "1.2rem", fontWeight: 700, letterSpacing: "-0.02em" }}>{ev.title}</div>
                      {ev.content && <div className="muted" style={{ fontSize: "0.875rem", marginTop: 2 }}>{ev.content}</div>}
                    </div>
                    {ev.finalized ? <span className="badge">마감됨</span>
                      : att && att.confirmed && !dirty ? <span className="badge badge-ok">확인 완료</span>
                      : <span className="badge badge-warn">{dirty ? "저장 안 됨" : "미확인"}</span>}
                  </div>
                  <div className="notice notice-accent" style={{ marginTop: "0.875rem" }}>
                    <strong>{fmtPeriods(ev)}</strong>에 없었던 학생만 눌러 <strong style={{ color: "var(--danger)" }}>불참</strong>으로 바꾸세요.
                    지각·조퇴라도 그 교시에 있었으면 참여입니다. 참여 {ev.hours}시간 · 불참 0시간.
                  </div>
                </div>
                {students.length === 0 ? (
                  <Empty title={`${classLabel(g, k)} 명단이 없습니다.`} sub="학급 명단을 먼저 올려 주세요.">
                    <button className="btn" onClick={() => go(`#roster/${g}-${k}`)}>학급 명단으로</button>
                  </Empty>
                ) : (
                  <>
                    <div style={{ padding: "0 1.375rem 1.125rem" }}>
                      <div className="tiles">
                        {students.map((s) => {
                          const isOff = draft.has(s.id);
                          return (
                            <button key={s.id} className={`tile ${isOff ? "absent" : ""}`} aria-pressed={isOff} disabled={locked} onClick={() => toggle(s.id)}>
                              <span className="no">{s.number}번</span>
                              <span className="nm">{s.name}</span>
                              {isOff && <span className="st">불참</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="panel-foot" style={{ flexWrap: "wrap", alignItems: "center" }}>
                      <div className="mr-auto num" style={{ fontSize: "0.875rem" }}>
                        참여 <strong>{students.length - off}</strong> · 불참 <strong style={{ color: off ? "var(--danger)" : undefined }}>{off}</strong>
                        {att && att.confirmed && <span className="faint" style={{ marginLeft: 8, fontSize: "0.8rem" }}>{att.confirmedBy} {fmtTime(att.confirmedAt)}</span>}
                      </div>
                      {!locked && off > 0 && <button className="btn" onClick={() => setDraft(new Set())}>모두 참여로</button>}
                      {att && att.confirmed && !dirty && <button className="btn" onClick={() => setCertOpen(true)}><Icon name="printer" size={16} />확인서</button>}
                      {!locked && (
                        <button className="btn btn-primary" disabled={busy || (att && att.confirmed && !dirty)} onClick={save}>
                          {att && att.confirmed ? (dirty ? "변경 저장" : "확인 완료됨") : off ? `불참 ${off}명으로 확인 완료` : "전원 참여로 확인 완료"}
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        {certOpen && ev && (
          <CurriculumCertModal event={ev}
            results={classResults(ev, list, att ? { [classKey(g, k)]: att } : {}, { [classKey(g, k)]: homeroom && homeroom.grade === g && homeroom.klass === k ? me : "" })
              .filter((r) => r.grade === g && r.klass === k)}
            onClose={() => setCertOpen(false)} />
        )}
      </>
    );
  }

  // ============================================================
  // 활동 관리 · 현황판 (관리자)
  // ============================================================
  function EventsPage({ roster, events, teachers, route, go }) {
    const ev = route.eventId ? (events || []).find((e) => e.id === route.eventId) : null;
    if (route.eventId && events !== null && !ev) {
      return <><PageHead title="교육과정 내 봉사" back={() => go("#events")} /><div className="card"><Empty title="활동을 찾을 수 없습니다." /></div></>;
    }
    if (ev) return <EventDetail ev={ev} roster={roster || []} teachers={teachers || []} go={go} />;
    return <EventList events={events} go={go} />;
  }

  function EventList({ events, go }) {
    const [editing, setEditing] = useState(null); // null | "new" | event
    const wide = useWide();
    const all = useCollection(PATHS.attendance);
    const confirmedBy = useMemo(() => {
      const m = {};
      (all || []).forEach((a) => { if (a.confirmed) m[a.eventId] = (m[a.eventId] || 0) + 1; });
      return m;
    }, [all]);
    const list = events || [];
    const guide = (
      <div className="panel-body" style={{ paddingTop: "1.25rem" }}>
        <div className="card-title" style={{ marginBottom: "0.5rem" }}>진행 순서</div>
        <ol className="muted" style={{ fontSize: "0.875rem", paddingLeft: "1.1rem", margin: 0, listStyle: "decimal", display: "grid", gap: "0.35rem" }}>
          <li>활동을 추가합니다(날짜·교시·인정 시간·내용).</li>
          <li>담임 선생님이 출결 화면에서 그 교시에 없던 학생만 불참으로 바꾸고 확인 완료를 누릅니다.</li>
          <li>활동을 눌러 현황판에서 학급별 확인 여부를 봅니다.</li>
          <li>모두 확인되면 마감하고 학급별 확인서를 출력합니다.</li>
        </ol>
      </div>
    );
    return (
      <>
        <PageHead title="교육과정 내 봉사" sub={`활동 ${list.length}건`}
          actions={<button className="btn btn-primary" onClick={() => setEditing("new")}><Icon name="plus" size={16} />활동 추가</button>} />
        <div className="split">
          <div className="card" style={{ overflow: "hidden" }}>
            {events === null ? <Empty title="불러오는 중…" /> : list.length === 0 ? (
              <Empty title="등록된 활동이 없습니다." sub="활동 추가를 눌러 날짜와 교시를 정하세요." />
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>날짜</th>
                    <th>활동</th>
                    <th className="hidden sm:table-cell">교시</th>
                    <th className="col-wide">대상</th>
                    <th className="col-xwide">인정</th>
                    <th style={{ textAlign: "right" }}>확인</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((e) => (
                    <tr key={e.id} className="row-open" tabIndex={0} onClick={() => go(`#events/${e.id}`)} onKeyDown={(x) => x.key === "Enter" && go(`#events/${e.id}`)}>
                      <td className="num whitespace-nowrap">{fmtDate(e.date)}</td>
                      <td><span className="font-semibold">{e.title}</span><div className="text-xs muted">{e.area}</div></td>
                      <td className="hidden sm:table-cell num muted whitespace-nowrap">{fmtPeriods(e)}</td>
                      <td className="col-wide muted whitespace-nowrap">{eventGrades(e).length === 3 ? "전교생" : eventGrades(e).map((g) => `${g}학년`).join("·")}</td>
                      <td className="col-xwide num muted">{e.hours}시간</td>
                      <td className="num whitespace-nowrap" style={{ textAlign: "right" }}>
                        {e.finalized ? <span className="badge">마감</span> : <span className="muted">{confirmedBy[e.id] || 0}개 반</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <EventForm key={editing && editing !== "new" ? editing.id : String(editing)} ev={editing === "new" ? null : editing}
            open={!!editing} onClose={() => setEditing(null)} placeholder={wide ? guide : null}
            onSaved={(id) => { setEditing(null); if (id) go(`#events/${id}`); }} />
        </div>
      </>
    );
  }

  function EventForm({ ev, open, onClose, onSaved, placeholder, modal }) {
    const [f, setF] = useState(() => ev ? { ...ev, grades: eventGrades(ev) } : {
      title: "", date: todayKey(), periodStart: 5, periodEnd: 6, hours: 1, area: AREAS[1], content: "", grades: [...GRADES],
    });
    const [busy, setBusy] = useState(false);
    const set = (p) => setF((x) => ({ ...x, ...p }));
    const toggleGrade = (g) => set({ grades: f.grades.includes(g) ? f.grades.filter((x) => x !== g) : [...f.grades, g].sort() });

    const save = async () => {
      if (!f.title.trim()) return toast("활동 이름을 입력하세요.", "danger");
      if (!f.date) return toast("날짜를 고르세요.", "danger");
      if (!f.grades.length) return toast("대상 학년을 하나 이상 고르세요.", "danger");
      if (f.periodEnd < f.periodStart) return toast("끝 교시가 시작 교시보다 앞입니다.", "danger");
      const data = {
        title: f.title.trim(), date: f.date, periodStart: toInt(f.periodStart), periodEnd: toInt(f.periodEnd),
        hours: Math.max(1, toInt(f.hours) || 1), area: f.area, content: f.content.trim(), grades: f.grades,
        updatedAt: FieldValue.serverTimestamp(),
      };
      setBusy(true);
      try {
        if (ev) {
          await db.collection(PATHS.events).doc(ev.id).update(data);
          toast("저장했습니다.");
          onSaved(null);
        } else {
          const ref = db.collection(PATHS.events).doc();
          await ref.set({ ...data, finalized: false, createdAt: FieldValue.serverTimestamp() });
          toast("활동을 추가했습니다.");
          onSaved(ref.id);
        }
      } catch (err) {
        console.error(err);
        toast("저장하지 못했습니다.", "danger");
      }
      setBusy(false);
    };

    return (
      <Inspector open={open} modal={modal} title={ev ? "활동 수정" : "활동 추가"} sub={ev && ev.finalized ? "마감된 활동입니다. 고친 내용은 확인서에 바로 반영됩니다." : ""}
        onClose={onClose} placeholder={placeholder}
        footer={<><button className="btn" onClick={onClose}>취소</button><button className="btn btn-primary" disabled={busy} onClick={save}>{ev ? "저장" : "추가"}</button></>}>
        <div className="fields">
          <div><label className="field-label">활동 이름</label><input className="inp" value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder="예: 학교 주변 환경 정화" /></div>
          <div><label className="field-label">날짜</label><input type="date" className="inp" value={f.date} onChange={(e) => set({ date: e.target.value })} /></div>
          <div>
            <span className="field-label">교시</span>
            <div className="flex items-center gap-2">
              <select className="inp" value={f.periodStart} onChange={(e) => { const v = toInt(e.target.value); set({ periodStart: v, periodEnd: Math.max(v, f.periodEnd) }); }} aria-label="시작 교시">
                {PERIODS.map((p) => <option key={p} value={p}>{p}교시</option>)}
              </select>
              <span className="muted">–</span>
              <select className="inp" value={f.periodEnd} onChange={(e) => set({ periodEnd: toInt(e.target.value) })} aria-label="끝 교시">
                {PERIODS.filter((p) => p >= f.periodStart).map((p) => <option key={p} value={p}>{p}교시</option>)}
              </select>
            </div>
          </div>
          <div className="grid gap-2" style={{ gridTemplateColumns: "6rem 1fr" }}>
            <div><label className="field-label">인정 시간</label><input type="number" min="1" className="inp num" value={f.hours} onChange={(e) => set({ hours: e.target.value })} /></div>
            <div>
              <label className="field-label">봉사영역</label>
              <select className="inp" value={f.area} onChange={(e) => set({ area: e.target.value })}>{AREAS.map((a) => <option key={a} value={a}>{a}</option>)}</select>
            </div>
          </div>
          <div>
            <span className="field-label">대상 학년</span>
            <div className="chips">
              {GRADES.map((g) => <button key={g} type="button" className="btn btn-sm" aria-pressed={f.grades.includes(g)} onClick={() => toggleGrade(g)}>{g}학년</button>)}
            </div>
          </div>
          <div>
            <label className="field-label">활동 내용 <span className="faint" style={{ fontWeight: 400 }}>(확인서에 들어감)</span></label>
            <textarea className="inp" rows="3" value={f.content} onChange={(e) => set({ content: e.target.value })} placeholder="예: 교내 및 학교 주변 쓰레기 줍기, 분리배출 캠페인" />
          </div>
        </div>
      </Inspector>
    );
  }

  function EventDetail({ ev, roster, teachers, go }) {
    const attByKey = useAttendanceFor(ev.id);
    const teacherByClass = useMemo(() => {
      const m = {};
      teachers.filter((t) => t.status === "approved" && t.homeroom).forEach((t) => {
        const k = classKey(t.grade, t.klass);
        m[k] = m[k] ? `${m[k]}·${t.name}` : t.name;
      });
      return m;
    }, [teachers]);
    const results = useMemo(() => classResults(ev, roster, attByKey, teacherByClass), [ev, roster, attByKey, teacherByClass]);
    const [editing, setEditing] = useState(false);
    const [certOpen, setCertOpen] = useState(false);
    const [busy, setBusy] = useState(false);

    const done = results.filter((r) => r.confirmed).length;
    const part = results.reduce((n, r) => n + r.participants.length, 0);
    const off = results.reduce((n, r) => n + r.absent.length, 0);
    const byGrade = GRADES.map((g) => [g, results.filter((r) => r.grade === g)]).filter(([, rs]) => rs.length);

    const finalize = async () => {
      const left = results.filter((r) => !r.confirmed);
      if (left.length && !window.confirm(`아직 확인하지 않은 학급 ${left.length}개가 있습니다(${left.map((r) => `${r.grade}-${r.klass}`).join(", ")}).\n이 학급은 지금 명단 그대로 전원 참여로 마감됩니다. 계속할까요?`)) return;
      if (!left.length && !window.confirm("마감하면 지금 명단과 출결이 확인서용으로 고정되고, 담임은 더 이상 고칠 수 없습니다. 마감할까요?")) return;
      setBusy(true);
      const strip = (s) => ({ number: s.number, name: s.name });
      const snapshot = Object.fromEntries(results.map((r) => [r.key, {
        grade: r.grade, klass: r.klass, teacher: r.teacher, confirmed: r.confirmed, confirmedBy: r.confirmedBy || "",
        participants: r.participants.map(strip), absent: r.absent.map(strip),
      }]));
      try {
        await db.collection(PATHS.events).doc(ev.id).update({ finalized: true, finalizedAt: FieldValue.serverTimestamp(), snapshot });
        toast("마감했습니다.");
      } catch (err) {
        console.error(err);
        toast("마감하지 못했습니다.", "danger");
      }
      setBusy(false);
    };
    const unfinalize = async () => {
      if (!window.confirm("마감을 풀면 담임이 다시 출결을 고칠 수 있고, 확인서는 지금 명단 기준으로 다시 계산됩니다. 풀까요?")) return;
      await db.collection(PATHS.events).doc(ev.id).update({ finalized: false, snapshot: FieldValue.delete() });
      toast("마감을 풀었습니다.");
    };
    const remove = async () => {
      if (!window.confirm(`'${ev.title}' 활동과 학급별 출결 기록을 모두 지웁니다. 되돌릴 수 없습니다. 계속할까요?`)) return;
      const snap = await db.collection(PATHS.attendance).where("eventId", "==", ev.id).get();
      await commitInChunks([...snap.docs.map((d) => (b) => b.delete(d.ref)), (b) => b.delete(db.collection(PATHS.events).doc(ev.id))]);
      toast("활동을 지웠습니다.");
      go("#events");
    };
    const exportCsv = () => {
      const rows = [];
      results.forEach((r) => {
        [...r.participants.map((s) => [s, true]), ...r.absent.map((s) => [s, false])]
          .sort((a, b) => a[0].number - b[0].number)
          .forEach(([s, on]) => rows.push([r.grade, r.klass, s.number, s.name, on ? "참여" : "불참", on ? ev.hours : 0, ev.title, ev.date, fmtPeriods(ev), ev.area, ev.content]));
      });
      downloadCsv(`교육과정내봉사_${ev.date}_${ev.title}.csv`, ["학년", "반", "번호", "이름", "참여", "인정시간", "활동", "날짜", "교시", "봉사영역", "활동내용"], rows);
      toast("CSV 파일을 내려받았습니다.");
    };

    const absentList = (
      <div className="card" style={{ overflow: "hidden" }}>
        <div className="card-head"><span className="card-title">불참 학생</span><span className="muted num" style={{ fontSize: "0.8125rem" }}>{off}명</span></div>
        {off === 0 ? <Empty title="불참 학생이 없습니다." /> : (
          <ul className="list">
            {results.filter((r) => r.absent.length).map((r) => (
              <li key={r.key}>
                <div className="section-label" style={{ marginBottom: 2 }}>{classLabel(r.grade, r.klass)}</div>
                <div style={{ fontSize: "0.875rem" }}>{r.absent.map((s) => `${s.number} ${s.name}`).join(", ")}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    );

    return (
      <>
        <PageHead back={() => go("#events")} title={ev.title}
          sub={`${fmtDate(ev.date, true)} · ${fmtPeriods(ev)} · ${ev.hours}시간 · ${ev.area}`}
          actions={<>
            <button className="btn btn-primary" onClick={() => setCertOpen(true)}><Icon name="printer" size={16} />확인서 출력</button>
            {ev.finalized
              ? <button className="btn" onClick={unfinalize}>마감 풀기</button>
              : <button className="btn" disabled={busy} onClick={finalize}>마감</button>}
            <MoreMenu items={[
              { label: "활동 수정", onClick: () => setEditing(true) },
              { label: "학생별 CSV 내보내기", onClick: exportCsv },
              "-",
              { label: "활동 삭제", danger: true, onClick: remove },
            ]} />
          </>} />

        {ev.finalized && <div className="notice" style={{ marginBottom: "1rem" }}>마감된 활동입니다. 마감할 때의 명단·출결로 확인서가 만들어지고, 담임은 출결을 고칠 수 없습니다.</div>}

        <div className="stats">
          <Stat label="확인 완료" value={done} unit={`/${results.length}개 반`} />
          <Stat label="참여 학생" value={part} unit="명" />
          <Stat label="불참 학생" value={off} unit="명" />
          <Stat label="인정 시간 합계" value={part * ev.hours} unit="시간" />
        </div>

        <div className="split">
          <div className="stack">
            {results.length === 0 ? (
              <div className="card"><Empty title="대상 학년의 학급 명단이 없습니다." sub="담임 선생님이 학급 명단을 올리면 여기에 학급이 나옵니다." /></div>
            ) : byGrade.map(([g, rs]) => (
              <div key={g} className="card card-pad">
                <div className="flex items-center gap-2" style={{ marginBottom: "0.75rem" }}>
                  <span className="card-title">{g}학년</span>
                  <span className="muted num" style={{ fontSize: "0.8125rem" }}>확인 {rs.filter((r) => r.confirmed).length}/{rs.length}</span>
                </div>
                <div className="class-grid">
                  {rs.map((r) => (
                    <button key={r.key} className={`class-cell ${r.confirmed ? "done" : ""} ${!r.hasRoster ? "missing" : ""}`}
                      onClick={() => go(`#attendance/${ev.id}/${r.grade}-${r.klass}`)}>
                      <span className="top">
                        <span className={`dot ${r.confirmed ? "dot-ok" : r.hasRoster ? "dot-warn" : ""}`} />
                        {r.klass}반
                        <span className="faint" style={{ fontWeight: 500, fontSize: "0.8rem", marginLeft: "auto" }}>{r.teacher || "담임 없음"}</span>
                      </span>
                      <span className="meta">
                        {!r.hasRoster ? "명단 없음" : r.confirmed ? `참여 ${r.participants.length} · 불참 ${r.absent.length}` : `미확인 · ${r.participants.length + r.absent.length}명`}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="side stack">{absentList}</div>
        </div>

        {editing && <EventForm ev={ev} open onClose={() => setEditing(false)} onSaved={() => setEditing(false)} modal />}
        {certOpen && <CurriculumCertModal event={ev} results={results} onClose={() => setCertOpen(false)} />}
      </>
    );
  }

  // ============================================================
  // 확인서 출력: 학급마다 1장, 확인자는 담임, 구분은 "학교교육과정 내"
  // ============================================================
  function CurriculumCertModal({ event, results, onClose }) {
    const [confirmDate, setConfirmDate] = useState(event.date || todayKey());
    const [excluded, setExcluded] = useState(() => new Set(results.filter((r) => !r.participants.length).map((r) => r.key)));
    const [names, setNames] = useState({});
    const [previewing, setPreviewing] = useState(results.length === 1);
    const fontOk = useMemo(() => (window.hasMalgun ? window.hasMalgun() : true), []);
    const teacherOf = (r) => (names[r.key] != null ? names[r.key] : r.teacher);
    const chosen = results.filter((r) => !excluded.has(r.key));

    const pages = useMemo(() => chosen.flatMap((r) => window.buildCertPages(
      {
        helperName: r.key,
        students: r.participants.map((s) => ({ grade: r.grade, class: r.klass, number: s.number, name: s.name, neisName: s.name, hours: event.hours })),
        defaultContent: event.content,
      },
      { area: event.area, inCurriculum: true, content: event.content, teacher: teacherOf(r) },
      confirmDate,
      { start: event.date, end: event.date }
    )), [chosen, names, confirmDate, event]);

    const warn = (r) => [
      !r.confirmed && "출결 미확인",
      !teacherOf(r) && "담임 이름 없음",
      !r.participants.length && "참여 학생 없음",
    ].filter(Boolean);
    const warnCount = chosen.filter((r) => warn(r).length).length;

    const print = async () => {
      if (!pages.length) return toast("출력할 학급을 고르세요.", "danger");
      if (warnCount && !window.confirm(`확인이 필요한 학급이 ${warnCount}개 있습니다. 그대로 출력할까요?`)) return;
      const prev = document.title;
      document.title = `교육과정 내 봉사활동 확인서_${event.title}`;
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      window.print();
      document.title = prev;
    };
    const toggle = (key) => setExcluded((p) => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n; });
    const allOn = chosen.length === results.length;
    const printRoot = document.getElementById("cert-print-root");

    return (
      <>
        <Modal title="확인서 출력" sub={`${event.title} · 학급마다 1장 · 인쇄 창에서 "PDF로 저장"을 고르면 PDF가 됩니다.`} onClose={onClose} width={960}
          footer={<>
            <button className="btn mr-auto" onClick={() => setPreviewing((v) => !v)}>{previewing ? "미리보기 닫기" : "미리보기"}</button>
            <button className="btn" onClick={onClose}>닫기</button>
            <button className="btn btn-primary" onClick={print}>PDF 저장 / 인쇄</button>
          </>}>
          <div className="fields">
            {!fontOk && <div className="notice notice-danger">이 컴퓨터에는 맑은 고딕이 없어서 글자 폭과 줄바꿈이 원본 양식과 달라집니다. 맑은 고딕이 있는 Windows PC에서 출력하세요.</div>}
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="field-label">확인 날짜</label>
                <input type="date" className="inp" style={{ width: "11rem" }} value={confirmDate} onChange={(e) => setConfirmDate(e.target.value)} />
              </div>
              {results.length > 1 && <button className="btn btn-sm" onClick={() => setExcluded(allOn ? new Set(results.map((r) => r.key)) : new Set())}>{allOn ? "모두 빼기" : "모두 고르기"}</button>}
              <span className="muted num ml-auto" style={{ fontSize: "0.8125rem" }}>
                {chosen.length}개 학급 · {pages.length}쪽{warnCount > 0 && <span style={{ color: "var(--warn)" }}> · 확인 필요 {warnCount}</span>}
              </span>
            </div>
            <div className="card" style={{ overflow: "hidden", boxShadow: "none", background: "var(--fill)" }}>
              <table className="data-table">
                <thead><tr><th style={{ width: "2.5rem" }}></th><th>학급</th><th>확인자(담임)</th><th style={{ textAlign: "right" }}>참여</th><th className="hidden sm:table-cell">확인할 점</th></tr></thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.key} style={{ opacity: excluded.has(r.key) ? 0.5 : 1 }}>
                      <td><input type="checkbox" checked={!excluded.has(r.key)} onChange={() => toggle(r.key)} aria-label={classLabel(r.grade, r.klass)} /></td>
                      <td className="font-semibold whitespace-nowrap">{classLabel(r.grade, r.klass)}</td>
                      <td><input className="inp" style={{ height: "2rem", maxWidth: "11rem" }} value={teacherOf(r)} onChange={(e) => setNames((p) => ({ ...p, [r.key]: e.target.value }))} placeholder="이름" /></td>
                      <td className="num" style={{ textAlign: "right" }}>{r.participants.length}명</td>
                      <td className="hidden sm:table-cell">{warn(r).map((w) => <span key={w} className="badge badge-warn mr-1">{w}</span>)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {previewing && pages.length > 0 && (
              <div className="cert-preview" style={{ background: "var(--fill)", borderRadius: 12, padding: "1rem", overflowX: "auto" }}>
                {pages.map((p, i) => <CertificateSheet key={i} page={p} />)}
              </div>
            )}
          </div>
        </Modal>
        {printRoot && ReactDOM.createPortal(pages.map((p, i) => <CertificateSheet key={i} page={p} />), printRoot)}
      </>
    );
  }

  Object.assign(window.GW, { RosterPage, AttendancePage, EventsPage });
})();
