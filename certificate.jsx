// 학교교육계획에 의한 단체봉사활동 실시 확인서
// 치수는 원본 HWPX 양식 값을 그대로 사용한다 (HWPUNIT 100 = 1pt).
(function () {
  const { useState, useEffect, useMemo } = React;

  const SCHOOL = "관산중학교";
  const G5 = "0.5mm solid #7F7F7F";
  const G3 = "0.3mm solid #7F7F7F";
  const K5 = "0.5mm solid #000000";
  const FILL = "#E5E5E5";

  // 한글 테두리/배경(borderFill) id → [왼, 오른, 위, 아래, 배경]
  const BF = {
    5: [G5, G5, G5, G3, FILL],
    7: [G5, G3, G3, G3, FILL],
    8: [G3, G5, G3, G3],
    9: [G5, G5, G3, G3, FILL],
    10: [G5, G3, G3, G3],
    11: [G3, G3, G3, G3],
    13: [G5, G5, G3, G5],
    14: [K5, G3, G3, G3],
    15: [G3, K5, G3, G3],
  };

  const LAYOUTS = {
    std: {
      perCol: 17,
      cols: [22.97, 31.46, 16.56, 12.07, 34.29, 82.4, 37.12, 25.8, 31.46, 28.63, 34.29, 82.4, 39.95],
      labelSpan: 3,
      titleH: 30.95,
      infoH: [21.29, 21.29, 21.29, 18.46, 21.29, 21.29],
      listH: 22.82,
      headH: 15.07,
      rowH: 17.9,
      footH: 148.58,
      leftSpans: [1, 1, 2, 1, 1, 1],
      head: { fs: 10, hoursFs: 10 },
      idxL: { fs: 10 },
      idxR: { fs: 10 },
      num: { fs: 9, spc: 0.04, ls: 160, ml: 5, mr: 5 },
      name: { fs: 9, ls: 103 },
      hours: { fs: 10, spc: 0.04, ls: 160, ml: 5, mr: 5 },
    },
    compact: {
      perCol: 31,
      cols: [22.97, 22.97, 22.97, 2.08, 23.72, 105.04, 39.95, 22.97, 31.46, 28.63, 34.29, 82.4, 39.95],
      labelSpan: 4,
      titleH: 22.46,
      infoH: [18.46, 18.46, 18.46, 18.46, 18.46, 18.46],
      listH: 18.46,
      headH: 9.8,
      rowH: 13.8,
      footH: 130.2,
      leftSpans: [1, 1, 1, 2, 1, 1],
      head: { fs: 7, hoursFs: 6 },
      idxL: { fs: 9 },
      idxR: { fs: 10 },
      num: { fs: 11, ls: 100 },
      name: { fs: 8, ls: 100 },
      hours: { fs: 11, ls: 100 },
    },
  };

  const AREAS = ["이웃돕기활동", "환경보호활동", "캠페인활동"];

  const bfStyle = (id) => {
    const [l, r, t, b, f] = BF[id];
    return { borderLeft: l, borderRight: r, borderTop: t, borderBottom: b, background: f || "transparent" };
  };

  // 한글은 빈칸을 글자 크기의 1/2, 고정폭 빈칸을 1/4로 그린다.
  // 실제로 쓰이는 폰트의 빈칸 폭을 재서 word-spacing으로 0.5em이 되게 맞춘다(다른 폰트로 대체되는 특수 공백은 줄 높이를 바꾸므로 쓰지 않음).
  function measureSpace() {
    const probe = document.createElement("div");
    probe.className = "cert-sheet";
    probe.style.cssText = "position:absolute;left:-9999px;top:0;width:auto;height:auto;padding:0;font-size:100px;white-space:pre";
    probe.innerHTML = "<span>가 가</span><span>가가</span>";
    document.body.appendChild(probe);
    const [a, b] = probe.children;
    const spaceEm = (a.getBoundingClientRect().width - b.getBoundingClientRect().width) / 100;
    probe.remove();
    if (spaceEm > 0) document.documentElement.style.setProperty("--cert-ws", (0.5 - spaceEm).toFixed(4) + "em");
  }
  measureSpace();
  if (document.fonts) {
    document.fonts.ready.then(measureSpace);
    document.fonts.addEventListener && document.fonts.addEventListener("loadingdone", measureSpace);
  }

  const FW_SPACE = { wordSpacing: "calc(var(--cert-ws, 0.25em) - 0.25em)" };
  const splitFw = (t, key) =>
    t.includes("　")
      ? t.split("　").flatMap((part, i) =>
          i === 0 ? [part] : [<span key={key + "-" + i} style={FW_SPACE}>{" "}</span>, part]
        )
      : t;
  const convert = (node, i) => {
    if (typeof node === "string") return splitFw(node, "s" + i);
    if (React.isValidElement(node) && typeof node.props.children === "string" && node.props.children.includes("　")) {
      return React.cloneElement(node, {}, splitFw(node.props.children, "c" + i));
    }
    return node;
  };

  // 한글은 마지막 줄 아래 줄간격을 높이에 넣지 않으므로, 위아래 반쪽 행간을 음수 여백으로 상쇄한다.
  function P({ fs, ls = 160, align = "center", ml = 0, mr = 0, w, indent = 0, bold, spc = 0, last = true, children }) {
    const lh = (fs * ls) / 100;
    const half = (lh - fs) / 2;
    const empty = children === "" || children == null;
    const content = empty ? null : React.Children.map(children, convert);
    return (
      <div
        className="cert-p"
        style={{
          fontSize: fs + "pt",
          lineHeight: lh + "pt",
          height: empty ? lh + "pt" : undefined,
          wordSpacing: "var(--cert-ws, 0.25em)",
          marginTop: -half + "pt",
          marginBottom: (last ? -half : half) + "pt",
          paddingLeft: w ? 0 : ml + "pt",
          paddingRight: w ? 0 : mr + "pt",
          width: w ? w + "pt" : undefined,
          textIndent: indent ? indent + "pt" : undefined,
          textAlign: align,
          fontWeight: bold ? 700 : 400,
          letterSpacing: spc ? spc + "em" : undefined,
        }}
      >
        {content}
      </div>
    );
  }

  const Td = ({ bf, span, children }) => (
    <td colSpan={span > 1 ? span : undefined} style={bfStyle(bf)}>
      {children}
    </td>
  );

  // 한글은 셀 안쪽 폭에서 문단 좌우 여백을 뺀 값이 14.4pt보다 작으면 여백을 버리고 14.4pt 폭으로 배치한다.
  const MIN_LINE = 14.4;
  const CELL_PAD = 2.8;
  const spanWidth = (L, startCol, span) => L.cols.slice(startCol, startCol + span).reduce((a, b) => a + b, 0);
  const fit = (cellW, ml = 5, mr = 5) => (cellW - CELL_PAD - ml - mr < MIN_LINE ? { w: MIN_LINE } : { ml, mr });

  const spaced = (s) => Array.from(String(s || "").replace(/\s+/g, "")).join("  ");

  function parseYMD(v) {
    const m = String(v || "").match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    if (!m) return null;
    return { y: +m[1], m: +m[2], d: +m[3], key: `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` };
  }

  const fmtStart = (d) => (d ? `${d.y}년  ${d.m}월  ${d.d}일부터` : "    년    월    일부터");
  const fmtEnd = (d) => (d ? `${d.y}년  ${d.m}월  ${d.d}일까지` : "    년    월    일까지");
  const fmtConfirm = (d) => (d ? `${d.y}년   ${d.m} 월   ${d.d} 일` : "    년     월     일");

  const toNum = (v) => {
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
  };

  const studentLabel = (s) =>
    `${s.grade || "?"}-${s.class || "?"}-${s.number || "?"} ${(s.name || s.neisName || "이름없음").trim()}`;

  // 다수와 다른 값을 가진 학생을 찾는다. 값이 비어 있는 학생은 누락 경고에서 따로 다룬다.
  function findOutliers(list, getter) {
    const counts = new Map();
    list.forEach((s) => {
      const v = getter(s);
      if (v) counts.set(v, (counts.get(v) || 0) + 1);
    });
    if (counts.size <= 1) return { top: counts.keys().next().value || "", outliers: [] };
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted[0][0];
    const tie = sorted[1][1] === sorted[0][1];
    const outliers = list.filter((s) => getter(s) && getter(s) !== top);
    return { top, outliers, tie };
  }

  function buildCertGroups(students) {
    const map = new Map();
    students.forEach((s) => {
      const key = (s.helperName || "").trim() || "(역할 없음)";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(s);
    });

    return [...map.entries()].map(([helperName, list]) => {
      const sorted = [...list].sort(
        (a, b) => toNum(a.grade) - toNum(b.grade) || toNum(a.class) - toNum(b.class) || toNum(a.number) - toNum(b.number)
      );
      const warnings = [];

      const missing = [];
      sorted.forEach((s) => {
        const miss = [];
        if (!String(s.grade || "").trim()) miss.push("학년");
        if (!String(s.class || "").trim()) miss.push("반");
        if (!String(s.number || "").trim()) miss.push("번호");
        if (!(s.neisName || s.name || "").trim()) miss.push("성명");
        if (s.hours === "" || s.hours == null || Number.isNaN(Number(s.hours))) miss.push("인정시간");
        if (!parseYMD(s.activityStartDate)) miss.push("시작일");
        if (!parseYMD(s.activityEndDate)) miss.push("종료일");
        if (!(s.activityContent || "").trim()) miss.push("활동내용");
        if (miss.length) missing.push(`${studentLabel(s)} (${miss.join(", ")})`);
      });
      if (missing.length) warnings.push({ title: `빈 값이 있는 학생 ${missing.length}명`, items: missing });

      const content = findOutliers(sorted, (s) => (s.activityContent || "").trim());
      if (content.outliers.length) {
        warnings.push({
          title: content.tie ? "활동내용이 여러 가지로 나뉘어 있음" : "활동내용이 다른 학생",
          items: content.outliers.map((s) => `${studentLabel(s)}: "${s.activityContent.trim()}"`),
        });
      }

      const startKey = (s) => (parseYMD(s.activityStartDate) || {}).key || "";
      const endKey = (s) => (parseYMD(s.activityEndDate) || {}).key || "";
      const start = findOutliers(sorted, startKey);
      if (start.outliers.length) {
        warnings.push({
          title: "활동 시작일이 다른 학생",
          items: start.outliers.map((s) => `${studentLabel(s)}: ${startKey(s)} (대부분 ${start.top})`),
        });
      }
      const end = findOutliers(sorted, endKey);
      if (end.outliers.length) {
        warnings.push({
          title: "활동 종료일이 다른 학생",
          items: end.outliers.map((s) => `${studentLabel(s)}: ${endKey(s)} (대부분 ${end.top})`),
        });
      }

      const starts = sorted.map((s) => parseYMD(s.activityStartDate)).filter(Boolean).sort((a, b) => (a.key < b.key ? -1 : 1));
      const ends = sorted.map((s) => parseYMD(s.activityEndDate)).filter(Boolean).sort((a, b) => (a.key < b.key ? -1 : 1));

      return {
        helperName,
        students: sorted,
        warnings,
        defaultContent: content.top,
        periodStart: starts[0] || null,
        periodEnd: ends[ends.length - 1] || null,
      };
    });
  }

  function paginate(rows) {
    const n = rows.length;
    const layout = n <= 34 ? "std" : "compact";
    const cap = LAYOUTS[layout].perCol * 2;
    const pages = [];
    for (let i = 0; i < Math.max(n, 1); i += cap) {
      const items = rows.slice(i, i + cap).map((r, k) => ({ ...r, idx: i + k + 1 }));
      const last = i + cap >= n;
      const slots = new Array(cap).fill(null);
      items.forEach((it, k) => (slots[k] = it));
      if (last && items.length < cap) slots[items.length] = "END";
      pages.push({ layout, slots });
    }
    return pages;
  }

  function buildPages(group, setting, confirmDate, period = {}) {
    const rows = group.students.map((s) => ({
      grade: s.grade,
      class: s.class,
      number: s.number,
      name: (s.neisName || s.name || "").trim(),
      hours: s.hours,
    }));
    const first = group.students[0] || {};
    const others = group.students.length - 1;
    const info = {
      grade: first.grade || "",
      klass: first.class || "",
      personName: `${rows[0] ? rows[0].name : ""}${others > 0 ? ` 외 ${others}명` : ""}`,
      start: period.start ? parseYMD(period.start) : group.periodStart,
      end: period.end ? parseYMD(period.end) : group.periodEnd,
      area: setting.area || AREAS[0],
      inCurriculum: !!setting.inCurriculum,
      content: setting.content != null ? setting.content : group.defaultContent,
      teacher: setting.teacher || "",
      title: setting.title || "교사",
      stamp: setting.stamp || "",
      confirm: parseYMD(confirmDate),
    };
    return paginate(rows).map((p) => ({ ...p, info, key: group.helperName }));
  }

  // 명단 한쪽(왼쪽/오른쪽) 6칸의 [테두리, 열 병합 수, 셀 폭]
  function sideCells(L, side) {
    const right = side === "R";
    const bfs = right ? [14, 11, 11, 11, 11, 8] : [10, 11, 11, 11, 11, 15];
    const spans = right ? [1, 1, 1, 1, 1, 1] : L.leftSpans;
    let col = right ? 7 : 0;
    return spans.map((span, i) => {
      const cell = { bf: bfs[i], span, w: spanWidth(L, col, span) };
      col += span;
      return cell;
    });
  }

  function DataCells({ slot, side, L }) {
    const cells = sideCells(L, side);
    const idxStyle = side === "R" ? L.idxR : L.idxL;
    const cell = (i, content) => (
      <Td key={side + i} bf={cells[i].bf} span={cells[i].span}>
        {content}
      </Td>
    );
    const withFit = (i, style) => (style.ml || style.mr ? { ...style, ...fit(cells[i].w, style.ml, style.mr) } : style);

    if (slot === "END") {
      const endP = (i, t) => <P fs={10} spc={0.04} {...fit(cells[i].w)}>{t}</P>;
      return [
        cell(0, <P fs={10}>{""}</P>),
        cell(1, endP(1, "이")),
        cell(2, endP(2, "하")),
        cell(3, <P fs={10}>{""}</P>),
        cell(4, endP(4, "빈")),
        cell(5, endP(5, "칸")),
      ];
    }
    const s = slot || {};
    const has = !!slot;
    return [
      cell(0, <P fs={idxStyle.fs} spc={0.04} {...fit(cells[0].w)}>{has ? String(s.idx) : ""}</P>),
      cell(1, <P {...withFit(1, L.num)}>{has ? String(s.grade ?? "") : ""}</P>),
      cell(2, <P {...withFit(2, L.num)}>{has ? String(s.class ?? "") : ""}</P>),
      cell(3, <P {...withFit(3, L.num)}>{has ? String(s.number ?? "") : ""}</P>),
      cell(4, <P {...L.name}>{has ? s.name : ""}</P>),
      cell(5, <P {...withFit(5, L.hours)}>{has ? String(s.hours ?? "") : ""}</P>),
    ];
  }

  const HEAD_L = [["연번", -0.06], ["학년", -0.14], ["반", 0.04], ["번호", 0.04], ["성명", 0.04], ["인정시간", 0.04]];
  const HEAD_R = [["연번", 0.04], ["학년", -0.15], ["반", 0.04], ["번호", 0.04], ["성명", 0.04], ["인정시간", 0.04]];

  function HeadCells({ L }) {
    const render = (side, labels) =>
      sideCells(L, side).map((c, i) => (
        <Td key={side + i} bf={c.bf} span={c.span}>
          <P fs={i === 5 ? L.head.hoursFs : L.head.fs} bold spc={labels[i][1]} {...fit(c.w)}>
            {labels[i][0]}
          </P>
        </Td>
      ));
    return (
      <>
        {render("L", HEAD_L)}
        {render("R", HEAD_R)}
      </>
    );
  }

  function CertificateSheet({ page }) {
    const L = LAYOUTS[page.layout];
    const { info } = page;
    const valSpan = 13 - L.labelSpan;
    // ✓는 맑은 고딕에 없어 대체 폰트로 그려지므로, 줄 높이에 영향을 주지 않게 line-height 0으로 둔다.
    const check = <span style={{ lineHeight: 0 }}>✓</span>;
    const mark = (on, blanks) => (on ? ["(  ", check, "  )"] : ["(" + " ".repeat(blanks) + ")"]);

    const infoRows = [
      [
        "단체봉사 구분",
        <P fs={10} align="justify" ml={5} mr={5}>
          <span style={{ letterSpacing: "0.04em" }}>학교교육과정 내 봉사활동</span>
          {"　"}
          {mark(info.inCurriculum, 6)}
          {" "}
          <span style={{ letterSpacing: "0.04em" }}> / 학교교육과정 외의 봉사활동</span>
          {"　"}
          {mark(!info.inCurriculum, 6)}
        </P>,
      ],
      [
        "인적 사항",
        <P fs={10} align="justify">
          <span>{" 관산중"}</span>
          <span style={{ letterSpacing: "0.04em" }}>{`학교  ${info.grade}학년  ${info.klass}반  성명: `}</span>
          <span style={{ fontSize: "9pt" }}>{info.personName}</span>
        </P>,
      ],
      [
        "봉사활동 기간",
        <P fs={10} align="justify" ml={5} mr={5} spc={0.04}>
          {`${fmtStart(info.start)}        ${fmtEnd(info.end)}`}
        </P>,
      ],
      [
        "봉사영역",
        <P fs={10} align="justify" ml={5} mr={5}>
          {AREAS.map((a, i) => [i > 0 ? "    " : "", a, ...mark(info.area === a, 5)])}
          {" "}
        </P>,
      ],
      [
        "활동 장소",
        <P fs={10} align="justify" ml={5} mr={5} spc={0.04}>
          {SCHOOL}
        </P>,
      ],
      [
        "활동 내용",
        <P fs={10} ls={110} align="justify" ml={3} spc={-0.12}>
          {info.content}
        </P>,
      ],
    ];

    const rows = [];
    for (let r = 0; r < L.perCol; r++) {
      rows.push(
        <tr key={"d" + r} style={{ height: L.rowH + "pt" }}>
          {DataCells({ slot: page.slots[r], side: "L", L })}
          {DataCells({ slot: page.slots[L.perCol + r], side: "R", L })}
        </tr>
      );
    }

    return (
      <div className="cert-sheet">
        <table>
          <colgroup>
            {L.cols.map((w, i) => (
              <col key={i} style={{ width: w + "pt" }} />
            ))}
          </colgroup>
          <tbody>
            <tr style={{ height: L.titleH + "pt" }}>
              <Td bf={5} span={13}>
                <P fs={14} bold>
                  <span style={{ fontSize: "11pt" }}> </span>
                  <span>학교교육계획에 의한 단체봉사활동 실시 확인서</span>
                </P>
              </Td>
            </tr>
            {infoRows.map(([label, value], i) => (
              <tr key={"i" + i} style={{ height: L.infoH[i] + "pt" }}>
                <Td bf={7} span={L.labelSpan}>
                  <P fs={10} ls={130} bold>
                    {label}
                  </P>
                </Td>
                <Td bf={8} span={valSpan}>
                  {value}
                </Td>
              </tr>
            ))}
            <tr style={{ height: L.listH + "pt" }}>
              <Td bf={9} span={13}>
                <P fs={10} ls={130} bold>
                  봉사활동 참여자 명단
                </P>
              </Td>
            </tr>
            <tr style={{ height: L.headH + "pt" }}>
              <HeadCells L={L} />
            </tr>
            {rows}
            <tr style={{ height: L.footH + "pt" }}>
              <Td bf={13} span={13}>
                <P fs={6} ls={180} align="justify" ml={5} mr={5} last={false}>{""}</P>
                <P fs={10} ls={180} bold last={false}>
                  위 학생들은 위와 같이 단체봉사활동에 참여하였으며 이 기재내용은 사실과 틀림없음을 확인합니다.
                </P>
                <P fs={10} ls={180} bold last={false}>{""}</P>
                <P fs={10} ls={180} bold last={false}>
                  {fmtConfirm(info.confirm)}
                </P>
                <P fs={10} ls={180} bold last={false}>
                  {` 확  인  자 : ${info.title}　 ${spaced(info.teacher)}  `}
                  {/* 도장 이미지는 (인) 위에 겹쳐 찍는다. 줄 높이에 영향을 주지 않게 absolute로 둔다. */}
                  <span style={{ position: "relative", display: "inline-block" }}>
                    (인)
                    {info.stamp && (
                      <img src={info.stamp} alt="" style={{
                        position: "absolute", left: "50%", top: "50%", height: "40pt", width: "auto",
                        maxWidth: "60pt", transform: "translate(-50%, -50%)", mixBlendMode: "multiply", pointerEvents: "none",
                      }} />
                    )}
                  </span>
                </P>
                <P fs={10} ls={130} bold last={false}>{""}</P>
                <P fs={12} ls={180} bold align="justify" indent={130.51} last={false}>
                  <span>{"    확인기관명 : "}</span>
                  <span style={{ letterSpacing: "0.18em" }}>관산중학교장</span>
                </P>
                <P fs={10} ls={180} ml={5} mr={5} spc={0.16}>{""}</P>
              </Td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  const SETTINGS_KEY = "cert_settings_v1";

  function hasMalgun() {
    const ctx = document.createElement("canvas").getContext("2d");
    const sample = "가나다라 ABC 123";
    return ["monospace", "serif"].some((fallback) => {
      ctx.font = `20px ${fallback}`;
      const base = ctx.measureText(sample).width;
      ctx.font = `20px 'Malgun Gothic', '맑은 고딕', ${fallback}`;
      return ctx.measureText(sample).width !== base;
    });
  }

  function CertificateModal({ students, db, settingsDocPath, onClose, onToast }) {
    const gradeOf = (s) => String(s.grade ?? "").trim() || "미지정";
    const allGrades = useMemo(
      () => [...new Set(students.map(gradeOf))].sort((a, b) => toNum(a) - toNum(b)),
      [students]
    );
    const [grades, setGrades] = useState(() => new Set(allGrades));
    const groups = useMemo(
      () => buildCertGroups(students.filter((s) => grades.has(gradeOf(s)))),
      [students, grades]
    );
    const [settings, setSettings] = useState({});
    const [excluded, setExcluded] = useState(() => new Set());
    const selected = useMemo(
      () => new Set(groups.map((g) => g.helperName).filter((n) => !excluded.has(n))),
      [groups, excluded]
    );
    // 활동 기간은 출력할 때마다 바뀌는 값이라 저장하지 않고 이 창에서만 쓴다.
    const [periods, setPeriods] = useState({});
    const setPeriod = (helperName, patch) =>
      setPeriods((prev) => ({ ...prev, [helperName]: { ...(prev[helperName] || {}), ...patch } }));
    const toggleGrade = (g) =>
      setGrades((prev) => {
        const next = new Set(prev);
        next.has(g) ? next.delete(g) : next.add(g);
        return next;
      });
    const [confirmDate, setConfirmDate] = useState(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    });
    const [openWarn, setOpenWarn] = useState({});
    const [previewing, setPreviewing] = useState(false);
    const fontOk = useMemo(hasMalgun, []);

    useEffect(() => {
      let local = {};
      try {
        local = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
      } catch (e) {
        local = {};
      }
      setSettings(local);
      if (db) {
        db.doc(settingsDocPath)
          .get()
          .then((snap) => {
            if (snap.exists) setSettings((prev) => ({ ...prev, ...(snap.data().roles || {}) }));
          })
          .catch((err) => console.error("확인서 설정 불러오기 실패:", err));
      }
    }, []);

    const update = (helperName, patch) =>
      setSettings((prev) => ({ ...prev, [helperName]: { ...(prev[helperName] || {}), ...patch } }));

    const toggle = (helperName) =>
      setExcluded((prev) => {
        const next = new Set(prev);
        next.has(helperName) ? next.delete(helperName) : next.add(helperName);
        return next;
      });

    const pages = useMemo(
      () =>
        groups
          .filter((g) => selected.has(g.helperName))
          .flatMap((g) => buildPages(g, settings[g.helperName] || {}, confirmDate, periods[g.helperName])),
      [groups, selected, settings, confirmDate, periods]
    );

    const saveSettings = async () => {
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      } catch (e) {}
      if (db) {
        try {
          await db.doc(settingsDocPath).set({ roles: settings }, { merge: true });
        } catch (err) {
          console.error("확인서 설정 저장 실패:", err);
        }
      }
    };

    const handlePrint = async () => {
      if (!pages.length) {
        onToast && onToast("출력할 역할을 선택하세요.", "danger");
        return;
      }
      const noTeacher = groups.filter((g) => selected.has(g.helperName) && !(settings[g.helperName] || {}).teacher);
      if (noTeacher.length && !window.confirm(`확인자 교사 이름이 비어 있는 역할이 있습니다: ${noTeacher.map((g) => g.helperName).join(", ")}\n그대로 출력할까요?`)) {
        return;
      }
      await saveSettings();
      const prevTitle = document.title;
      document.title = "단체봉사활동 실시 확인서";
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      window.print();
      document.title = prevTitle;
    };

    const warnCount = groups.filter((g) => selected.has(g.helperName)).reduce((n, g) => n + g.warnings.length, 0);
    const printRoot = document.getElementById("cert-print-root");

    return (
      <>
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
          <div className="modal max-w-[960px]">
            <div className="modal-head">
              <div>
                <h3 className="font-bold">확인서 출력</h3>
                <p className="text-[13px] muted mt-0.5">도우미 역할마다 확인서가 1장씩 만들어집니다. 인쇄 창에서 대상을 "PDF로 저장"으로 고르면 PDF로 저장됩니다.</p>
              </div>
              <button onClick={onClose} className="btn btn-sm btn-ghost" style={{ padding: "0 8px" }} aria-label="닫기">✕</button>
            </div>

            <div className="modal-body space-y-4">
              {!fontOk && (
                <div className="rounded-md px-3 py-2.5 text-[13px]" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>
                  이 컴퓨터에는 맑은 고딕이 없어서 글자 폭과 줄바꿈이 원본 양식과 달라집니다. 맑은 고딕이 있는 Windows PC에서 출력하세요.
                </div>
              )}

              <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
                <div>
                  <label className="field-label">확인 날짜</label>
                  <input type="date" value={confirmDate} onChange={(e) => setConfirmDate(e.target.value)} className="inp" style={{ width: 176 }} />
                </div>
                <div>
                  <span className="field-label">학년</span>
                  <div className="flex flex-wrap gap-1.5">
                    {allGrades.map((g) => (
                      <button
                        key={g}
                        onClick={() => toggleGrade(g)}
                        aria-pressed={grades.has(g)}
                        className={`btn ${grades.has(g) ? "btn-primary" : ""}`}
                      >
                        {g === "미지정" ? g : `${g}학년`}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-[13px] muted num sm:ml-auto pb-2">
                  {selected.size}개 역할 · {pages.length}쪽
                  {warnCount > 0 && <span style={{ color: "var(--warn)" }}> · 확인할 내용 {warnCount}건</span>}
                </p>
              </div>

              {groups.length === 0 && (
                <p className="py-8 text-center text-sm muted">{grades.size === 0 ? "학년을 하나 이상 선택하세요." : "선택한 학년에 등록된 도우미가 없습니다."}</p>
              )}

              <div className="space-y-2">
                {groups.map((g) => {
                  const st = settings[g.helperName] || {};
                  const on = selected.has(g.helperName);
                  const per = periods[g.helperName] || {};
                  const edited = per.start || per.end;
                  return (
                    <div key={g.helperName} className="rounded-md border" style={{ borderColor: "var(--line)", opacity: on ? 1 : 0.55 }}>
                      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5" style={{ background: "var(--surface-2)" }}>
                        <label className="flex items-center gap-2 font-semibold cursor-pointer min-w-0">
                          <input type="checkbox" checked={on} onChange={() => toggle(g.helperName)} />
                          <span className="truncate">{g.helperName}</span>
                        </label>
                        <span className="text-[13px] muted num">{g.students.length}명</span>
                        {g.warnings.length > 0 && (
                          <button
                            onClick={() => setOpenWarn((p) => ({ ...p, [g.helperName]: !p[g.helperName] }))}
                            className="badge badge-warn ml-auto cursor-pointer"
                          >
                            확인 필요 {g.warnings.length}건 {openWarn[g.helperName] ? "▲" : "▼"}
                          </button>
                        )}
                      </div>

                      {g.warnings.length > 0 && openWarn[g.helperName] && (
                        <div className="px-3 py-2.5 space-y-2 text-[13px] border-t" style={{ borderColor: "var(--line)", background: "var(--warn-soft)" }}>
                          {g.warnings.map((w, i) => (
                            <div key={i}>
                              <div className="font-semibold" style={{ color: "var(--warn)" }}>{w.title}</div>
                              <ul className="list-disc pl-5 mt-0.5">
                                {w.items.map((it, j) => <li key={j}>{it}</li>)}
                              </ul>
                            </div>
                          ))}
                        </div>
                      )}

                      {on && (
                        <div className="p-3 grid grid-cols-2 md:grid-cols-12 gap-2.5 border-t" style={{ borderColor: "var(--line)" }}>
                          <div className="col-span-2 md:col-span-3">
                            <label className="field-label">확인자 교사</label>
                            <input value={st.teacher || ""} onChange={(e) => update(g.helperName, { teacher: e.target.value })} placeholder="이름" className="inp" />
                          </div>
                          <div className="col-span-2 md:col-span-5">
                            <label className="field-label">활동 내용</label>
                            <input value={st.content != null ? st.content : g.defaultContent} onChange={(e) => update(g.helperName, { content: e.target.value })} className="inp" />
                          </div>
                          <div className="md:col-span-2">
                            <label className="field-label">봉사영역</label>
                            <select value={st.area || AREAS[0]} onChange={(e) => update(g.helperName, { area: e.target.value })} className="inp">
                              {AREAS.map((a) => <option key={a} value={a}>{a.replace("활동", "")}</option>)}
                            </select>
                          </div>
                          <div className="md:col-span-2">
                            <label className="field-label">구분</label>
                            <select value={st.inCurriculum ? "in" : "out"} onChange={(e) => update(g.helperName, { inCurriculum: e.target.value === "in" })} className="inp">
                              <option value="out">교육과정 외</option>
                              <option value="in">교육과정 내</option>
                            </select>
                          </div>
                          <div className="md:col-span-3">
                            <label className="field-label">활동 시작일</label>
                            <input type="date" value={per.start || (g.periodStart ? g.periodStart.key : "")} onChange={(e) => setPeriod(g.helperName, { start: e.target.value })} className="inp" />
                          </div>
                          <div className="md:col-span-3">
                            <label className="field-label">활동 종료일</label>
                            <input type="date" value={per.end || (g.periodEnd ? g.periodEnd.key : "")} onChange={(e) => setPeriod(g.helperName, { end: e.target.value })} className="inp" />
                          </div>
                          <div className="col-span-2 md:col-span-6 flex items-end pb-2 text-[13px] muted">
                            {edited ? (
                              <button onClick={() => setPeriods((prev) => ({ ...prev, [g.helperName]: {} }))} className="btn btn-sm">
                                학생 기록 기준으로 되돌리기
                              </button>
                            ) : (
                              "기간은 학생 기록에서 가장 이른 시작일과 가장 늦은 종료일입니다."
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {previewing && pages.length > 0 && (
                <div className="cert-preview rounded-md p-4 overflow-x-auto" style={{ background: "var(--surface-2)", border: "1px solid var(--line)" }}>
                  {pages.map((p, i) => <CertificateSheet key={i} page={p} />)}
                </div>
              )}
            </div>

            <div className="modal-foot">
              <window.GW.IconBtn icon={previewing ? "eyeOff" : "eye"} label={previewing ? "미리보기 닫기" : "미리보기"} onClick={() => setPreviewing((v) => !v)} className="mr-auto" />
              <window.GW.IconBtn icon="printer" label="PDF 저장 / 인쇄" primary onClick={handlePrint} />
            </div>
          </div>
        </div>
        {printRoot &&
          ReactDOM.createPortal(
            pages.map((p, i) => <CertificateSheet key={i} page={p} />),
            printRoot
          )}
      </>
    );
  }

  window.CertificateModal = CertificateModal;
  window.hasMalgun = hasMalgun;
  window.CertificateSheet = CertificateSheet;
  window.buildCertGroups = buildCertGroups;
  window.buildCertPages = buildPages;
})();
