// 교육과정 외 봉사: 도우미 명단 · 인정 시간 수정 · 변경 이력 · 확인서 출력
(function () {
  const { useState, useMemo, useEffect } = React;
  const { db, PATHS, toInt, commitInChunks, downloadCsv, readTextFile, toast,
    useCollection, useWide, Icon, IconBtn, Modal, Inspector, PageHead, Empty, MoreMenu } = window.GW;

  const ROLE_PRESETS = ["급식 도우미", "학급 분리수거도우미", "특별실 분리수거 도우미", "분리수거장 도우미", "기자재 관리도우미"];
  const sortStudents = (list) => [...list].sort((a, b) => (a.grade - b.grade) || (a.class - b.class) || (a.number - b.number));
  const shortDate = (d) => {
    const m = String(d || "").match(/^\d{4}-(\d{2})-(\d{2})$/);
    return m ? `${m[1]}.${m[2]}` : (d || "");
  };
  const period = (s) => (s.activityStartDate || s.activityEndDate)
    ? `${shortDate(s.activityStartDate) || "?"} – ${shortDate(s.activityEndDate) || "?"}` : "";
  const blank = { grade: "", class: "", number: "", neisName: "", name: "", helperName: ROLE_PRESETS[0], hours: 5, activityContent: "", activityStartDate: "", activityEndDate: "", reason: "" };

  const Hours = ({ s }) => (s.hours !== s.originalHours ? (
    <span className="num whitespace-nowrap">
      <span className="font-semibold" style={{ color: "var(--warn)" }}>{s.hours}시간</span>
      <span className="faint text-xs line-through ml-1">{s.originalHours}</span>
    </span>
  ) : <span className="num whitespace-nowrap">{s.hours}시간</span>);

  function HelpersPage({ isAdmin, operator }) {
    const students = useCollection(PATHS.students, sortStudents);
    const logs = useCollection(isAdmin ? PATHS.logs : null, (l) => [...l].sort((a, b) => String(b.id).localeCompare(String(a.id), undefined, { numeric: true })));
    const [q, setQ] = useState("");
    const [cls, setCls] = useState("all");
    const [role, setRole] = useState("all");
    const [selId, setSelId] = useState(null);
    const [adding, setAdding] = useState(false);
    const [logsOpen, setLogsOpen] = useState(false);
    const [certOpen, setCertOpen] = useState(false);
    const wide = useWide();

    const list = students || [];
    const classes = useMemo(() => [...new Set(list.map((s) => `${s.grade}학년 ${s.class}반`))].sort((a, b) => a.localeCompare(b, "ko", { numeric: true })), [list]);
    const roles = useMemo(() => [...new Set(list.map((s) => s.helperName).filter(Boolean))], [list]);
    const roleCounts = useMemo(() => {
      const m = new Map();
      list.forEach((s) => m.set(s.helperName || "(역할 없음)", (m.get(s.helperName || "(역할 없음)") || 0) + 1));
      return [...m].sort((a, b) => b[1] - a[1]);
    }, [list]);
    const filtered = useMemo(() => list.filter((s) => {
      if (cls !== "all" && `${s.grade}학년 ${s.class}반` !== cls) return false;
      if (role !== "all" && s.helperName !== role) return false;
      const t = q.trim().toLowerCase();
      if (t && ![s.name, s.neisName, s.helperName].some((v) => String(v || "").toLowerCase().includes(t))) return false;
      return true;
    }), [list, cls, role, q]);
    const edited = list.filter((s) => s.hours !== s.originalHours || s.reason).length;
    const hasFilter = q.trim() || cls !== "all" || role !== "all";
    const sel = list.find((s) => s.id === selId) || null;

    const open = (s) => { setAdding(false); setSelId(s.id); };
    const closeEditor = () => { setSelId(null); setAdding(false); };

    const saveLog = (s, originalHours, newHours, reason) => {
      const id = `log_${Date.now()}`;
      return db.collection(PATHS.logs).doc(id).set({
        id, timestamp: new Date().toLocaleString("ko-KR"),
        studentId: s.id, studentName: s.name, neisName: s.neisName || "", grade: s.grade, class: s.class, number: s.number,
        originalHours, newHours, reason, operator,
      });
    };

    // CSV로 받은 명단으로 전체를 바꾼다.
    const replaceAll = async (rows) => {
      const snap = await db.collection(PATHS.students).get();
      const col = db.collection(PATHS.students);
      await commitInChunks([
        ...snap.docs.map((d) => (b) => b.delete(d.ref)),
        ...rows.map((s) => (b) => b.set(col.doc(s.id), s)),
      ]);
    };

    const importCsv = async (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      const text = await readTextFile(file);
      const data = Papa.parse(text, { header: true, skipEmptyLines: true }).data;
      if (!data.length) return toast("CSV 파일에 데이터가 없습니다.", "danger");
      if (!window.confirm(`지금 명단 ${list.length}명을 지우고 CSV의 ${data.length}명으로 바꿉니다. 계속할까요?`)) return;
      const now = Date.now();
      const rows = data.map((row, idx) => {
        const get = (cands) => {
          const k = Object.keys(row).find((key) => cands.some((c) => key.trim().replace(/\s/g, "").includes(c)));
          return k ? String(row[k]).trim() : "";
        };
        const hours = toInt(get(["봉사시간", "인정시간", "시간", "hours"])) ?? 5;
        return {
          id: `csv_${idx}_${now}`,
          grade: toInt(get(["학년", "grade"])) || 1,
          class: toInt(get(["반", "class"])) || 1,
          number: toInt(get(["번호", "number", "no"])) || 1,
          neisName: get(["나이스성명", "영문성명", "neis"]),
          name: get(["한글이름", "이름", "name"]),
          helperName: get(["도우미명", "도우미역할", "도우미", "역할", "role"]) || "일반 도우미",
          activityContent: get(["활동내용", "활동", "activity"]),
          activityStartDate: get(["활동시작일", "시작일", "startDate"]),
          activityEndDate: get(["활동종료일", "종료일", "endDate"]),
          hours,
          originalHours: hours,
          reason: get(["봉사시간변경사유", "변경사유", "사유", "reason"]),
        };
      });
      try {
        await replaceAll(rows);
        toast(`${rows.length}명을 불러왔습니다.`);
      } catch (err) {
        console.error(err);
        toast("저장 중 오류가 발생했습니다.", "danger");
      }
    };

    const exportCsv = () => {
      if (!list.length) return toast("내보낼 데이터가 없습니다.", "danger");
      downloadCsv(`도우미_봉사조정명세_${new Date().toISOString().slice(0, 10)}.csv`,
        ["학년", "반", "번호", "나이스 성명", "한글 이름", "인정시간", "도우미명", "활동내용", "활동시작일", "활동종료일", "봉사시간 변경 사유"],
        list.map((s) => [s.grade, s.class, s.number, s.neisName, s.name, s.hours, s.helperName, s.activityContent, s.activityStartDate, s.activityEndDate, s.reason]));
      toast("CSV 파일을 내려받았습니다.");
    };

    const resetAll = async () => {
      if (!window.confirm("도우미 명단과 변경 이력을 모두 지웁니다. 되돌릴 수 없습니다. 계속할까요?")) return;
      const [a, b] = await Promise.all([db.collection(PATHS.students).get(), db.collection(PATHS.logs).get()]);
      await commitInChunks([...a.docs, ...b.docs].map((d) => (batch) => batch.delete(d.ref)));
      closeEditor();
      toast("초기화했습니다.");
    };

    const summary = (
      <div className="panel-body" style={{ paddingTop: "1.25rem" }}>
        <div className="card-title" style={{ marginBottom: "0.75rem" }}>역할별 인원</div>
        {roleCounts.length === 0 ? <p className="muted" style={{ fontSize: "0.875rem" }}>등록된 도우미가 없습니다.</p> : (
          <div className="grid gap-1">
            {roleCounts.map(([r, n]) => (
              <button key={r} onClick={() => setRole(role === r ? "all" : r)} className={`event-item ${role === r ? "on" : ""}`} style={{ gridTemplateColumns: "1fr auto", alignItems: "center" }}>
                <span className="ttl" style={{ fontWeight: 500 }}>{r}</span>
                <span className="num muted">{n}명</span>
              </button>
            ))}
          </div>
        )}
        <p className="faint" style={{ fontSize: "0.8rem", marginTop: "1rem" }}>학생 줄을 누르면 이 자리에서 바로 수정합니다.</p>
      </div>
    );

    return (
      <>
        <PageHead
          title="교육과정 외 봉사"
          sub={`도우미 ${list.length}명${edited ? ` · 시간 변경 ${edited}명` : ""}`}
          actions={isAdmin && (
            <>
              <IconBtn icon="printer" label="확인서 출력" primary onClick={() => setCertOpen(true)} />
              <IconBtn icon="plus" label="도우미 추가" onClick={() => { setSelId(null); setAdding(true); }} />
              <MoreMenu items={[
                { label: "CSV 가져오기 (전체 교체)", file: ".csv", onChange: importCsv },
                { label: "CSV 내보내기", onClick: exportCsv },
                { label: `변경 이력 (미확인 ${(logs || []).filter((l) => !l.checkedBy).length})`, onClick: () => setLogsOpen(true) },
                "-",
                { label: "전체 초기화", danger: true, onClick: resetAll },
              ]} />
            </>
          )}
        />

        <div className="split">
          <div className="stack">
            <div className="card toolbar">
              <div className="search">
                <Icon name="search" size={15} />
                <input type="search" className="inp" value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름, 나이스 성명, 역할로 검색" />
              </div>
              <select className="inp" value={cls} onChange={(e) => setCls(e.target.value)} aria-label="학급">
                <option value="all">전체 학급</option>
                {classes.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select className="inp" value={role} onChange={(e) => setRole(e.target.value)} aria-label="역할">
                <option value="all">전체 역할</option>
                {roles.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              {hasFilter && <IconBtn icon="close" label="조건 지우기" small ghost onClick={() => { setQ(""); setCls("all"); setRole("all"); }} />}
              <span className="muted num ml-auto" style={{ fontSize: "0.8125rem" }}>{hasFilter ? `검색 결과 ${filtered.length}명` : `${filtered.length}명`}</span>
            </div>

            <div className="card" style={{ overflow: "hidden" }}>
              {students === null ? <Empty title="불러오는 중…" /> : filtered.length === 0 ? (
                <Empty title={list.length === 0 ? "등록된 도우미가 없습니다." : "조건에 맞는 학생이 없습니다."} sub={list.length ? "검색어나 학급·역할 조건을 바꿔 보세요." : isAdmin ? "도우미 추가 또는 ⋯ 메뉴의 CSV 가져오기로 등록하세요." : ""} />
              ) : (
                <>
                  <table className="data-table hidden md:table">
                    <thead>
                      <tr>
                        <th style={{ width: "5.5rem" }}>학년·반·번호</th>
                        <th>이름</th>
                        <th>역할</th>
                        <th className="col-xwide">활동 내용</th>
                        <th style={{ width: "8rem" }}>활동 기간</th>
                        <th style={{ width: "6rem", textAlign: "right" }}>인정 시간</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((s) => (
                        <tr key={s.id} className={`row-open ${selId === s.id ? "selected" : ""}`} tabIndex={0}
                          onClick={() => open(s)} onKeyDown={(e) => e.key === "Enter" && open(s)}>
                          <td className="num muted whitespace-nowrap">{s.grade}-{s.class}-{s.number}</td>
                          <td>
                            <span className="font-semibold">{s.name}</span>
                            {s.neisName && s.neisName !== s.name && <div className="text-xs muted leading-tight">{s.neisName}</div>}
                          </td>
                          <td>
                            <span className="whitespace-nowrap">{s.helperName}</span>
                            {s.activityContent && <div className="text-xs muted leading-tight xl-hide">{s.activityContent}</div>}
                          </td>
                          <td className="col-xwide muted">{s.activityContent}</td>
                          <td className="num muted whitespace-nowrap">{period(s) || "–"}</td>
                          <td style={{ textAlign: "right" }}><Hours s={s} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <ul className="list md:hidden">
                    {filtered.map((s) => (
                      <li key={s.id} className="row-open flex items-start gap-3" onClick={() => open(s)}>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <span className="font-semibold">{s.name}</span>
                            <span className="text-xs faint num">{s.grade}-{s.class}-{s.number}</span>
                          </div>
                          <div style={{ fontSize: "0.85rem" }}>{s.helperName}</div>
                          {(s.activityContent || period(s)) && <div className="text-xs muted num">{[s.activityContent, period(s)].filter(Boolean).join(" · ")}</div>}
                        </div>
                        <div style={{ fontSize: "0.875rem" }}><Hours s={s} /></div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>

          <StudentEditor
            key={adding ? "new" : sel ? sel.id : "none"}
            student={adding ? null : sel}
            open={adding || !!sel}
            isAdmin={isAdmin}
            roleOptions={[...new Set([...ROLE_PRESETS, ...roles])]}
            onClose={closeEditor}
            onSaveLog={saveLog}
            placeholder={wide ? summary : null}
          />
        </div>

        {isAdmin && logsOpen && <LogsModal logs={logs || []} students={list} reviewer={operator} onClose={() => setLogsOpen(false)} />}
        {isAdmin && certOpen && (
          <CertificateModal students={list} db={db} settingsDocPath={PATHS.certSettings} onClose={() => setCertOpen(false)} onToast={toast} />
        )}
      </>
    );
  }

  function StudentEditor({ student, open, isAdmin, roleOptions, onClose, onSaveLog, placeholder }) {
    const isNew = !student;
    const [f, setF] = useState(() => student ? {
      grade: String(student.grade), class: String(student.class), number: String(student.number),
      name: student.name || "", neisName: student.neisName || "", helperName: student.helperName || "",
      activityContent: student.activityContent || "", activityStartDate: student.activityStartDate || "",
      activityEndDate: student.activityEndDate || "", hours: student.hours, reason: student.reason || "",
    } : { ...blank });
    const [err, setErr] = useState("");
    const [busy, setBusy] = useState(false);
    const set = (patch) => { setF((p) => ({ ...p, ...patch })); setErr(""); };
    const hoursChanged = !isNew && Number(f.hours) !== student.hours;

    const save = async () => {
      if (!toInt(f.grade) || !toInt(f.class) || !toInt(f.number) || !f.name.trim()) return setErr("학년, 반, 번호, 이름을 모두 입력하세요.");
      if (hoursChanged && !f.reason.trim()) return setErr("인정 시간을 바꾸면 특이사항을 적어야 합니다.");
      const data = {
        grade: toInt(f.grade), class: toInt(f.class), number: toInt(f.number),
        name: f.name.trim(), neisName: (f.neisName || "").trim() || (isNew ? f.name.trim() : ""),
        helperName: f.helperName, activityContent: f.activityContent.trim(),
        activityStartDate: f.activityStartDate, activityEndDate: f.activityEndDate,
        hours: Math.max(0, Number(f.hours) || 0), reason: f.reason,
      };
      setBusy(true);
      try {
        if (isNew) {
          const id = `manual_${Date.now()}`;
          await db.collection(PATHS.students).doc(id).set({ id, ...data, originalHours: data.hours, reason: "" });
          toast(`${data.name} 학생을 추가했습니다.`);
          setF({ ...blank, helperName: data.helperName, hours: data.hours, activityContent: data.activityContent, activityStartDate: data.activityStartDate, activityEndDate: data.activityEndDate });
        } else {
          await db.collection(PATHS.students).doc(student.id).update(data);
          if (data.hours !== student.hours || data.reason !== (student.reason || "")) {
            await onSaveLog({ ...student, ...data }, student.hours, data.hours, data.reason);
          }
          toast("저장했습니다.");
          onClose();
        }
      } catch (e) {
        console.error(e);
        setErr("저장하지 못했습니다.");
      }
      setBusy(false);
    };

    const remove = async () => {
      if (!window.confirm(`${student.name} 학생을 명단에서 제외할까요?`)) return;
      await db.collection(PATHS.students).doc(student.id).delete();
      toast(`${student.name} 학생을 명단에서 제외했습니다.`);
      onClose();
    };

    return (
      <Inspector
        open={open}
        title={isNew ? "도우미 추가" : student.name}
        sub={isNew ? "추가하면 칸이 비워져 계속 입력할 수 있습니다." : `${student.helperName} · 처음 배정 ${student.originalHours}시간`}
        onClose={onClose}
        placeholder={placeholder}
        footer={
          <>
            {!isNew && isAdmin && <IconBtn icon="trash" label="명단에서 제외" ghost danger className="mr-auto" onClick={remove} />}
            <IconBtn icon={isNew ? "plus" : "ok"} label={isNew ? "추가" : "저장"} primary tipLeft disabled={busy} onClick={save} />
          </>
        }
      >
        <div className="fields">
          <div className="grid grid-cols-3 gap-2">
            <div><label className="field-label">학년</label><input type="number" min="1" max="3" className="inp" value={f.grade} onChange={(e) => set({ grade: e.target.value })} /></div>
            <div><label className="field-label">반</label><input type="number" min="1" className="inp" value={f.class} onChange={(e) => set({ class: e.target.value })} /></div>
            <div><label className="field-label">번호</label><input type="number" min="1" className="inp" value={f.number} onChange={(e) => set({ number: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="field-label">이름</label><input className="inp" value={f.name} onChange={(e) => set({ name: e.target.value })} /></div>
            <div><label className="field-label">나이스 성명</label><input className="inp" value={f.neisName} onChange={(e) => set({ neisName: e.target.value })} placeholder="다를 때만" /></div>
          </div>
          <div>
            <label className="field-label">역할</label>
            {isNew ? (
              <select className="inp" value={f.helperName} onChange={(e) => set({ helperName: e.target.value })}>
                {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            ) : <input className="inp" value={f.helperName} onChange={(e) => set({ helperName: e.target.value })} />}
          </div>
          <div><label className="field-label">활동 내용</label><input className="inp" value={f.activityContent} onChange={(e) => set({ activityContent: e.target.value })} placeholder="예: 급식실 청결 및 질서 유지 도우미 활동" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="field-label">활동 시작일</label><input type="date" className="inp" value={f.activityStartDate} onChange={(e) => set({ activityStartDate: e.target.value })} /></div>
            <div><label className="field-label">활동 종료일</label><input type="date" className="inp" value={f.activityEndDate} onChange={(e) => set({ activityEndDate: e.target.value })} /></div>
          </div>
          <div>
            <label className="field-label">인정 시간</label>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => set({ hours: Math.max(0, Number(f.hours) - 1) })} className="btn btn-icon" aria-label="1시간 줄이기">−</button>
              <input type="number" min="0" className="inp num text-center" style={{ width: "4.5rem" }} value={f.hours} onChange={(e) => set({ hours: Math.max(0, Number(e.target.value)) })} />
              <button type="button" onClick={() => set({ hours: Number(f.hours) + 1 })} className="btn btn-icon" aria-label="1시간 늘리기">+</button>
              <span className="muted" style={{ fontSize: "0.8125rem" }}>시간</span>
            </div>
          </div>
          {!isNew && (
            <div>
              <label className="field-label">특이사항{hoursChanged && <span style={{ color: "var(--danger)" }}> (시간을 바꾸면 필수)</span>}</label>
              <textarea rows="3" className="inp" value={f.reason} onChange={(e) => set({ reason: e.target.value })} placeholder="예: 활동 불성실로 시간 단축" />
            </div>
          )}
          {err && <p className="field-error" style={{ marginTop: 0 }}>{err}</p>}
        </div>
      </Inspector>
    );
  }

  // 나이스 성명(영문 이름 등)이 한글 이름과 다르면 "나이스 성명(한글 이름)"으로 보인다.
  const displayName = (s) => {
    const neis = (s.neisName || "").trim();
    return neis && neis !== s.name ? `${neis}(${s.name})` : s.name;
  };

  // 이력은 지우지 않고 관리자가 확인 표시만 한다.
  function LogsModal({ logs, students, reviewer, onClose }) {
    // 예전 이력에는 학년·반이 없어서 지금 명단에서 찾아 채운다(같은 이름이 둘 이상이면 비워 둔다).
    const who = (l) => {
      if (l.grade) return { name: displayName({ name: l.studentName, neisName: l.neisName }), cls: `${l.grade}학년 ${l.class}반${l.number ? ` ${l.number}번` : ""}` };
      const byId = l.studentId && students.find((s) => s.id === l.studentId);
      const byName = students.filter((s) => s.name === l.studentName);
      const s = byId || (byName.length === 1 ? byName[0] : null);
      return s ? { name: displayName(s), cls: `${s.grade}학년 ${s.class}반 ${s.number}번` } : { name: l.studentName, cls: "" };
    };
    const [checked, setChecked] = useState({});
    const open = logs.filter((l) => !l.checkedBy);
    const ids = Object.keys(checked).filter((k) => checked[k] && open.some((l) => l.id === k));
    const confirmSelected = async () => {
      if (!ids.length) return;
      const at = new Date().toLocaleString("ko-KR");
      await commitInChunks(ids.map((id) => (b) => b.update(db.collection(PATHS.logs).doc(id), { checkedBy: reviewer, checkedAt: at })));
      setChecked({});
      toast(`${ids.length}건을 확인했습니다.`);
    };
    return (
      <Modal title="변경 이력" sub={`${logs.length}건 · 미확인 ${open.length}건`} onClose={onClose} width={860}
        footer={<>
          {open.length > 0 && <IconBtn icon="ok" label={ids.length ? `선택한 ${ids.length}건 관리자 확인` : "확인할 이력을 고르세요"} primary tipLeft disabled={!ids.length} onClick={confirmSelected} />}
        </>}>
        {logs.length === 0 ? <Empty title="변경 이력이 없습니다." /> : (
          <div style={{ margin: "-1.125rem -1.375rem" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: "2.5rem" }}>{open.length > 0 && <input type="checkbox" aria-label="미확인 전체 선택" checked={open.every((l) => checked[l.id])} onChange={(e) => setChecked(e.target.checked ? Object.fromEntries(open.map((l) => [l.id, true])) : {})} />}</th>
                  <th>학생</th>
                  <th style={{ textAlign: "right" }}>시간</th>
                  <th>사유</th>
                  <th className="hidden sm:table-cell">변경자 · 일시</th>
                  <th>관리자 확인</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td>{!l.checkedBy && <input type="checkbox" checked={!!checked[l.id]} onChange={() => setChecked((p) => ({ ...p, [l.id]: !p[l.id] }))} aria-label="확인할 이력 선택" />}</td>
                    <td className="whitespace-nowrap">
                      <div className="font-semibold">{who(l).name}</div>
                      {who(l).cls && <div className="text-xs muted num">{who(l).cls}</div>}
                    </td>
                    <td className="num whitespace-nowrap" style={{ textAlign: "right" }}>{l.originalHours} → <strong>{l.newHours}</strong></td>
                    <td className="muted">{l.reason}</td>
                    <td className="hidden sm:table-cell muted text-xs num">{l.operator}<br />{l.timestamp}</td>
                    <td className="whitespace-nowrap">
                      {l.checkedBy
                        ? <><span className="badge badge-ok">확인</span><div className="text-xs muted num" style={{ marginTop: 2 }}>{l.checkedBy}<br />{l.checkedAt}</div></>
                        : <span className="badge badge-warn">미확인</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    );
  }

  Object.assign(window.GW, { HelpersPage });
})();
