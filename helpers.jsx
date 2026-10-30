// 교육과정 외 봉사: 역할(학년별 기간) · 학생 배정 · 인정 시간 수정(사유 필수) · 명단 점검 · 변경 이력 · 확인서
// 활동 내용과 기간은 역할에 저장하고, 학생은 역할에 배정만 한다. 같은 역할·같은 학년이면 기간이 같다.
// 역할마다 담당 교사가 1명 있고, 담당 교사는 자기 역할 학생의 인정 시간만 고칠 수 있다.
(function () {
  const { useState, useMemo } = React;
  const { db, FieldValue, PATHS, AREAS, GRADES, toInt, classLabel, studentKey, normName, displayName, termLabel,
    commitInChunks, downloadCsv, toast, useCollection, useMedia, Icon, IconBtn, Modal, PageHead, Empty, MoreMenu, Seg } = window.GW;

  const sortByStudent = (list) => [...list].sort((a, b) => (a.grade - b.grade) || (a.class - b.class) || (a.number - b.number));
  const sortRoles = (list) => [...list].sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || String(a.name).localeCompare(String(b.name), "ko"));
  const newKey = () => Math.random().toString(36).slice(2, 10);
  const shortDate = (d) => {
    const m = String(d || "").match(/^\d{4}-(\d{2})-(\d{2})$/);
    return m ? `${m[1]}.${m[2]}` : "";
  };
  const periodOf = (role, grade) => (role && role.periods && role.periods[String(grade)]) || {};
  const periodText = (p) => (p.start || p.end ? `${shortDate(p.start) || "?"} – ${shortDate(p.end) || "?"}` : "기간 없음");
  const stuLabel = (a) => `${a.grade}-${a.class}-${a.number} ${displayName(a.neisName, a.name)}`;

  // ---------- 명단 점검: 전교생 명단(학적 + 나이스 성명)과 배정 학생을 맞춰 본다 ----------
  function checkAssignments(assigns, roster, roles) {
    const roleKeys = new Set(roles.map((r) => r.key));
    const byKey = new Map(roster.map((r) => [studentKey(r.grade, r.klass, r.number), r]));
    const byName = new Map();
    roster.forEach((r) => {
      const n = normName(r.name);
      if (!byName.has(n)) byName.set(n, []);
      byName.get(n).push(r);
    });
    const issues = [];
    assigns.forEach((a) => {
      if (!roleKeys.has(a.roleKey)) issues.push({ a, type: "역할 없음", text: "지워진 역할에 배정되어 있습니다." });
      if (!roster.length) return;
      const r = byKey.get(studentKey(a.grade, a.class, a.number));
      const same = byName.get(normName(a.neisName)) || [];
      if (r && normName(r.name) === normName(a.neisName)) {
        const kr = r.koreanName || r.name;
        if (normName(kr) !== normName(a.name)) issues.push({ a, type: "한글 이름 다름", text: `명단의 한글 이름은 ${kr}입니다.`, fix: r });
      } else if (same.length === 1) {
        const m = same[0];
        issues.push({ a, type: "학적 다름", text: `명단에서는 ${m.grade}-${m.klass}-${m.number}입니다.`, fix: m });
      } else if (r) {
        issues.push({ a, type: "이름 다름", text: `명단의 ${r.grade}-${r.klass}-${r.number}은 ${displayName(r.name, r.koreanName)}입니다.`, fix: r });
      } else {
        issues.push({ a, type: "명단에 없음", text: "전교생 명단에서 찾지 못했습니다(전출 등)." });
      }
    });
    const seen = new Map();
    assigns.forEach((a) => {
      const k = `${a.roleKey}|${studentKey(a.grade, a.class, a.number)}`;
      if (seen.has(k)) issues.push({ a, type: "중복 배정", text: "같은 역할에 두 번 배정되어 있습니다.", dup: true });
      else seen.set(k, a);
    });
    return issues;
  }

  function HelpersPage({ isAdmin, me, uid, operator, term, readOnly, roster, teachers }) {
    const roles = useCollection(PATHS.roles, sortRoles, term);
    const assigns = useCollection(PATHS.students, sortByStudent, term);
    const logs = useCollection(isAdmin ? PATHS.logs : null, (l) => [...l].sort((a, b) => String(b.id).localeCompare(String(a.id), undefined, { numeric: true })), term);
    const roleList = roles || [];
    const list = assigns || [];
    const myRoleKeys = useMemo(() => new Set(roleList.filter((r) => r.teacherUid && r.teacherUid === uid).map((r) => r.key)), [roleList, uid]);
    const canEdit = (roleKey) => !readOnly && (isAdmin || myRoleKeys.has(roleKey));

    const [sel, setSel] = useState(null); // 역할 key, null이면 전체
    const [q, setQ] = useState("");
    const [grade, setGrade] = useState("all");
    const [editing, setEditing] = useState(null);
    const [roleEdit, setRoleEdit] = useState(null); // null | "new" | role
    const [assignOpen, setAssignOpen] = useState(false);
    const [logsOpen, setLogsOpen] = useState(false);
    const [certOpen, setCertOpen] = useState(false);
    const [checkOpen, setCheckOpen] = useState(false);
    const wide = useMedia("(min-width: 1280px)");

    const role = roleList.find((r) => r.key === sel) || null;
    const roleByKey = useMemo(() => Object.fromEntries(roleList.map((r) => [r.key, r])), [roleList]);
    const countBy = useMemo(() => {
      const m = {};
      list.forEach((a) => { m[a.roleKey] = (m[a.roleKey] || 0) + 1; });
      return m;
    }, [list]);
    const issues = useMemo(() => (isAdmin ? checkAssignments(list, roster || [], roleList) : []), [isAdmin, list, roster, roleList]);
    const issueIds = useMemo(() => new Set(issues.map((i) => i.a.id)), [issues]);

    const shown = list.filter((a) => {
      if (sel && a.roleKey !== sel) return false;
      if (grade !== "all" && a.grade !== +grade) return false;
      const t = normName(q);
      if (t && ![a.name, a.neisName, (roleByKey[a.roleKey] || {}).name].some((v) => normName(v).includes(t))) return false;
      return true;
    });
    const edited = list.filter((a) => a.hours !== a.originalHours).length;
    const openLogs = (logs || []).filter((l) => !l.checkedBy).length;

    const exportCsv = () => {
      if (!list.length) return toast("내보낼 데이터가 없습니다.", "danger");
      downloadCsv(`교육과정외봉사_${term}.csv`,
        ["학년", "반", "번호", "성명(나이스)", "한글 이름", "역할", "활동내용", "활동시작일", "활동종료일", "인정시간", "처음 시간", "특이사항"],
        list.map((a) => {
          const r = roleByKey[a.roleKey] || {};
          const p = periodOf(r, a.grade);
          return [a.grade, a.class, a.number, a.neisName, a.name, r.name || a.helperName || "", r.content || "", p.start || "", p.end || "", a.hours, a.originalHours, a.reason || ""];
        }));
      toast("CSV 파일을 내려받았습니다.");
    };

    const roleNav = (
      <nav className="panel card roster-nav" aria-label="역할">
        <button className={`roster-nav-item ${!sel ? "on" : ""}`} onClick={() => setSel(null)}>
          <span>전체</span><span className="num">{list.length}</span>
        </button>
        <div className="section-label" style={{ padding: "0.75rem 0.75rem 0.25rem" }}>역할</div>
        {roleList.map((r) => (
          <button key={r.key} className={`roster-nav-item role-item ${sel === r.key ? "on" : ""}`} onClick={() => setSel(r.key)}>
            <span className="min-w-0">
              <span className="block truncate">{r.name}</span>
              <span className="block truncate role-teacher">{r.teacherName || "담당 교사 없음"}{myRoleKeys.has(r.key) && " · 내 담당"}</span>
            </span>
            <span className="num">{countBy[r.key] || 0}</span>
          </button>
        ))}
        {!roleList.length && <p className="faint" style={{ fontSize: "0.8125rem", padding: "0.5rem 0.75rem" }}>{roles === null ? "불러오는 중…" : "역할이 없습니다."}</p>}
        {isAdmin && !readOnly && (
          <div style={{ padding: "0.5rem 0.25rem 0.25rem" }}>
            <IconBtn icon="plus" label="역할 추가" small onClick={() => setRoleEdit("new")} />
          </div>
        )}
      </nav>
    );

    return (
      <>
        <PageHead
          title="교육과정 외 봉사"
          sub={`${termLabel(term)} · 역할 ${roleList.length}개 · 배정 ${list.length}명${edited ? ` · 시간 변경 ${edited}명` : ""}`}
          actions={<>
            {!wide && (
              <select className="inp" style={{ width: "11rem" }} value={sel || ""} onChange={(e) => setSel(e.target.value || null)} aria-label="역할">
                <option value="">전체 역할</option>
                {roleList.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
              </select>
            )}
            {!wide && isAdmin && !readOnly && <IconBtn icon="plus" label="역할 추가" onClick={() => setRoleEdit("new")} />}
            {isAdmin && (
              <button className={`btn ${issues.length ? "btn-warn" : ""}`} data-tip="전교생 명단과 맞춰 보기" onClick={() => setCheckOpen(true)}>
                <Icon name="alert" size={16} /><span className="num">{issues.length}</span>
              </button>
            )}
            {isAdmin && <IconBtn icon="printer" label="확인서 출력" primary onClick={() => setCertOpen(true)} />}
            {isAdmin && (
              <MoreMenu items={[
                { label: "CSV 내보내기", onClick: exportCsv },
                { label: `변경 이력 (미확인 ${openLogs})`, onClick: () => setLogsOpen(true) },
              ]} />
            )}
          </>}
        />

        <div className="split split-left">
          {roleNav}
          <div className="stack">
            {role && <RoleSummary role={role} count={countBy[role.key] || 0} isAdmin={isAdmin} readOnly={readOnly}
              onEdit={() => setRoleEdit(role)} onAssign={() => setAssignOpen(true)} mine={myRoleKeys.has(role.key)} />}

            <div className="card" style={{ overflow: "hidden" }}>
              <div className="toolbar" style={{ borderBottom: "0.5px solid var(--hairline)" }}>
                <div className="search">
                  <Icon name="search" size={15} />
                  <input type="search" className="inp" value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·역할로 검색" />
                </div>
                <Seg value={grade} onChange={setGrade} options={[["all", "전체"], ...GRADES.map((g) => [String(g), `${g}학년`])]} />
                <span className="muted num ml-auto" style={{ fontSize: "0.8125rem" }}>{shown.length}명</span>
              </div>
              {assigns === null ? <Empty title="불러오는 중…" /> : shown.length === 0 ? (
                <Empty title={list.length ? "조건에 맞는 학생이 없습니다." : "배정된 학생이 없습니다."}
                  sub={isAdmin && !readOnly ? (role ? "＋를 눌러 전교생 명단에서 학생을 배정하세요." : "역할을 고른 뒤 학생을 배정하세요.") : ""} />
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: "5.5rem" }}>학년·반·번호</th>
                      <th>이름</th>
                      {!sel && <th>역할</th>}
                      <th className="col-wide">활동 기간</th>
                      <th style={{ width: "6rem", textAlign: "right" }}>인정 시간</th>
                      <th className="col-xwide">특이사항</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((a) => {
                      const r = roleByKey[a.roleKey];
                      const editable = canEdit(a.roleKey);
                      return (
                        <tr key={a.id} className="row-open" tabIndex={0} onClick={() => setEditing(a)} onKeyDown={(e) => e.key === "Enter" && setEditing(a)}>
                          <td className="num muted whitespace-nowrap">{a.grade}-{a.class}-{a.number}</td>
                          <td>
                            <span className="font-semibold">{displayName(a.neisName, a.name)}</span>
                            {issueIds.has(a.id) && <span className="badge badge-warn ml-1">점검</span>}
                            {editable && !isAdmin && <span className="badge badge-accent ml-1">수정 가능</span>}
                          </td>
                          {!sel && <td className="whitespace-nowrap">{r ? r.name : <span className="faint">{a.helperName || "역할 없음"}</span>}</td>}
                          <td className="col-wide num muted whitespace-nowrap">{periodText(periodOf(r, a.grade))}</td>
                          <td style={{ textAlign: "right" }}><Hours a={a} /></td>
                          <td className="col-xwide muted">{a.reason}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {editing && (
          <AssignEditor a={list.find((x) => x.id === editing.id) || editing} role={roleByKey[editing.roleKey]} roles={roleList}
            canEdit={canEdit(editing.roleKey)} isAdmin={isAdmin} operator={operator} term={term} onClose={() => setEditing(null)} />
        )}
        {roleEdit && (
          <RoleEditor role={roleEdit === "new" ? null : roleEdit} term={term} teachers={teachers || []} count={roleEdit !== "new" ? countBy[roleEdit.key] || 0 : 0}
            assigns={list} order={roleList.length}
            onClose={() => setRoleEdit(null)} onSaved={(key) => { setRoleEdit(null); if (key) setSel(key); }} onDeleted={() => { setRoleEdit(null); setSel(null); }} />
        )}
        {assignOpen && role && <AssignModal role={role} term={term} roster={roster || []} assigns={list} onClose={() => setAssignOpen(false)} />}
        {checkOpen && <CheckModal issues={issues} rosterCount={(roster || []).length} onClose={() => setCheckOpen(false)} />}
        {logsOpen && <LogsModal logs={logs || []} reviewer={operator} onClose={() => setLogsOpen(false)} />}
        {certOpen && <HelpersCertModal roles={roleList} assigns={list} teachers={teachers || []} issues={issues} onClose={() => setCertOpen(false)} />}
      </>
    );
  }

  const Hours = ({ a }) => (a.hours !== a.originalHours ? (
    <span className="num whitespace-nowrap">
      <span className="font-semibold" style={{ color: "var(--warn)" }}>{a.hours}시간</span>
      <span className="faint text-xs line-through ml-1">{a.originalHours}</span>
    </span>
  ) : <span className="num whitespace-nowrap">{a.hours}시간</span>);

  function RoleSummary({ role, count, isAdmin, readOnly, onEdit, onAssign, mine }) {
    return (
      <div className="card card-pad role-summary">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span style={{ fontSize: "1.2rem", fontWeight: 700, letterSpacing: "-0.02em" }}>{role.name}</span>
              <span className="badge num">{count}명</span>
              {mine && <span className="badge badge-accent">내 담당</span>}
            </div>
            <div className="muted" style={{ fontSize: "0.875rem", marginTop: 2 }}>{role.content || "활동 내용 없음"}</div>
          </div>
          {isAdmin && !readOnly && (
            <div className="flex gap-1.5">
              <IconBtn icon="edit" label="역할 고치기" onClick={onEdit} />
              <IconBtn icon="plus" label="학생 배정" primary tipLeft onClick={onAssign} />
            </div>
          )}
        </div>
        <div className="role-facts">
          {GRADES.map((g) => (
            <div key={g}><span className="faint">{g}학년</span><span className="num">{periodText(periodOf(role, g))}</span></div>
          ))}
          <div><span className="faint">기본 시간</span><span className="num">{role.hours}시간</span></div>
          <div><span className="faint">봉사영역</span><span>{role.area}</span></div>
          <div><span className="faint">담당 교사</span><span>{role.teacherName || "없음"}</span></div>
        </div>
      </div>
    );
  }

  // ---------- 역할 만들기·고치기 (관리자) ----------
  function RoleEditor({ role, term, teachers, count, assigns, order, onClose, onSaved, onDeleted }) {
    const blankPeriods = () => Object.fromEntries(GRADES.map((g) => [String(g), { start: "", end: "" }]));
    const [f, setF] = useState(() => role ? {
      name: role.name, content: role.content || "", area: role.area || AREAS[0], hours: role.hours ?? 5,
      periods: { ...blankPeriods(), ...(role.periods || {}) }, teacherUid: role.teacherUid || "",
    } : { name: "", content: "", area: AREAS[0], hours: 5, periods: blankPeriods(), teacherUid: "" });
    const [busy, setBusy] = useState(false);
    const set = (p) => setF((x) => ({ ...x, ...p }));
    const setPeriod = (g, p) => setF((x) => ({ ...x, periods: { ...x.periods, [g]: { ...x.periods[g], ...p } } }));
    const sameAll = () => setF((x) => ({ ...x, periods: Object.fromEntries(GRADES.map((g) => [String(g), { ...x.periods["1"] }])) }));
    const approved = teachers.filter((t) => t.status === "approved").sort((a, b) => String(a.name).localeCompare(String(b.name), "ko"));

    const save = async () => {
      if (!f.name.trim()) return toast("역할 이름을 입력하세요.", "danger");
      const bad = GRADES.find((g) => { const p = f.periods[g]; return p.start && p.end && p.end < p.start; });
      if (bad) return toast(`${bad}학년 종료일이 시작일보다 앞입니다.`, "danger");
      const t = approved.find((x) => x.id === f.teacherUid);
      const key = role ? role.key : newKey();
      const data = {
        term, key, name: f.name.trim(), content: f.content.trim(), area: f.area, hours: Math.max(0, toInt(f.hours) ?? 0),
        periods: f.periods, teacherUid: t ? t.id : "", teacherName: t ? t.name : "",
        updatedAt: FieldValue.serverTimestamp(),
      };
      setBusy(true);
      try {
        const ops = [(b) => b.set(db.collection(PATHS.roles).doc(`${term}_${key}`), role ? data : { ...data, order, createdAt: FieldValue.serverTimestamp() }, { merge: true })];
        // 역할 이름이 바뀌면 배정 학생의 표시용 이름도 맞춘다.
        if (role && role.name !== data.name) {
          assigns.filter((a) => a.roleKey === key).forEach((a) => ops.push((b) => b.update(db.collection(PATHS.students).doc(a.id), { helperName: data.name })));
        }
        await commitInChunks(ops);
        toast(role ? "역할을 저장했습니다." : "역할을 만들었습니다.");
        onSaved(role ? null : key);
      } catch (err) {
        console.error(err);
        toast("저장하지 못했습니다.", "danger");
      }
      setBusy(false);
    };
    const remove = async () => {
      if (!window.confirm(count ? `'${role.name}' 역할과 배정된 학생 ${count}명을 모두 지웁니다. 계속할까요?` : `'${role.name}' 역할을 지울까요?`)) return;
      await commitInChunks([
        ...assigns.filter((a) => a.roleKey === role.key).map((a) => (b) => b.delete(db.collection(PATHS.students).doc(a.id))),
        (b) => b.delete(db.collection(PATHS.roles).doc(role.id)),
      ]);
      toast("역할을 지웠습니다.");
      onDeleted();
    };

    return (
      <Modal title={role ? "역할 고치기" : "역할 추가"} sub="활동 내용과 학년별 기간은 이 역할의 모든 학생에게 똑같이 들어갑니다." onClose={onClose} width={620}
        footer={<>
          {role && <IconBtn icon="trash" label="역할 지우기" ghost danger className="mr-auto" onClick={remove} />}
          <IconBtn icon="ok" label={role ? "저장" : "추가"} primary tipLeft disabled={busy} onClick={save} />
        </>}>
        <div className="fields">
          <div className="grid gap-2" style={{ gridTemplateColumns: "minmax(0, 1fr) 6rem" }}>
            <div><label className="field-label">역할 이름</label><input className="inp" value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="예: 급식 도우미" /></div>
            <div><label className="field-label">기본 시간</label><input type="number" min="0" className="inp num" value={f.hours} onChange={(e) => set({ hours: e.target.value })} /></div>
          </div>
          <div><label className="field-label">활동 내용 <span className="faint" style={{ fontWeight: 400 }}>(확인서에 들어감)</span></label>
            <textarea className="inp" rows="2" value={f.content} onChange={(e) => set({ content: e.target.value })} placeholder="예: 급식실 청결 및 질서 유지 도우미 활동" /></div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div><label className="field-label">봉사영역</label>
              <select className="inp" value={f.area} onChange={(e) => set({ area: e.target.value })}>{AREAS.map((a) => <option key={a} value={a}>{a}</option>)}</select></div>
            <div><label className="field-label">담당 교사 <span className="faint" style={{ fontWeight: 400 }}>(확인서 확인자)</span></label>
              <select className="inp" value={f.teacherUid} onChange={(e) => set({ teacherUid: e.target.value })}>
                <option value="">없음</option>
                {approved.map((t) => <option key={t.id} value={t.id}>{t.name}{t.homeroom ? ` (${t.grade}-${t.klass} 담임)` : ""}</option>)}
              </select></div>
          </div>
          <div>
            <div className="flex items-center gap-2" style={{ marginBottom: "0.35rem" }}>
              <span className="field-label" style={{ margin: 0 }}>학년별 활동 기간</span>
              <button type="button" className="btn btn-sm ml-auto" onClick={sameAll}>1학년 기간을 모두에</button>
            </div>
            <div className="period-grid">
              {GRADES.map((g) => (
                <React.Fragment key={g}>
                  <span className="faint">{g}학년</span>
                  <input type="date" className="inp" value={f.periods[g].start} onChange={(e) => setPeriod(g, { start: e.target.value })} aria-label={`${g}학년 시작일`} />
                  <span className="faint">–</span>
                  <input type="date" className="inp" value={f.periods[g].end} onChange={(e) => setPeriod(g, { end: e.target.value })} aria-label={`${g}학년 종료일`} />
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    );
  }

  // ---------- 학생 배정: 전교생 명단에서 고른다 (관리자) ----------
  function AssignModal({ role, term, roster, assigns, onClose }) {
    const [grade, setGrade] = useState("all");
    const [klass, setKlass] = useState("all");
    const [q, setQ] = useState("");
    const [picked, setPicked] = useState(() => new Set());
    const [busy, setBusy] = useState(false);
    const taken = useMemo(() => new Set(assigns.filter((a) => a.roleKey === role.key).map((a) => studentKey(a.grade, a.class, a.number))), [assigns, role]);
    const classes = useMemo(() => [...new Set(roster.filter((r) => grade === "all" || r.grade === +grade).map((r) => r.klass))].sort((a, b) => a - b), [roster, grade]);
    const t = normName(q);
    const shown = roster
      .filter((r) => (grade === "all" || r.grade === +grade) && (klass === "all" || r.klass === +klass))
      .filter((r) => !t || normName(r.name).includes(t) || normName(r.koreanName).includes(t) || studentKey(r.grade, r.klass, r.number).startsWith(q.trim()))
      .sort((a, b) => (a.grade - b.grade) || (a.klass - b.klass) || (a.number - b.number));
    const toggle = (id) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
    const pickable = shown.filter((r) => !taken.has(studentKey(r.grade, r.klass, r.number)));
    const allOn = pickable.length > 0 && pickable.every((r) => picked.has(r.id));

    const save = async () => {
      const rows = roster.filter((r) => picked.has(r.id));
      setBusy(true);
      try {
        await commitInChunks(rows.map((r) => (b) => {
          const key = studentKey(r.grade, r.klass, r.number);
          b.set(db.collection(PATHS.students).doc(`${term}_${role.key}_${key}`), {
            term, roleKey: role.key, helperName: role.name, rosterKey: key,
            grade: r.grade, class: r.klass, number: r.number, neisName: r.name, name: r.koreanName || r.name,
            hours: role.hours, originalHours: role.hours, reason: "", createdAt: FieldValue.serverTimestamp(),
          });
        }));
        toast(`${rows.length}명을 '${role.name}'에 배정했습니다.`);
        onClose();
      } catch (err) {
        console.error(err);
        toast("배정하지 못했습니다.", "danger");
      }
      setBusy(false);
    };

    return (
      <Modal title={`${role.name} · 학생 배정`} sub="전교생 명단에서 고릅니다. 이미 배정된 학생은 흐리게 보입니다." onClose={onClose} width={760}
        footer={<IconBtn icon="ok" label={picked.size ? `${picked.size}명 배정` : "학생을 고르세요"} primary tipLeft disabled={busy || !picked.size} onClick={save} />}>
        {!roster.length ? <Empty title="전교생 명단이 없습니다." sub="학급 명단에서 먼저 명단을 올려 주세요." /> : (
          <div className="fields">
            <div className="flex flex-wrap gap-2 items-center">
              <Seg value={grade} onChange={(v) => { setGrade(v); setKlass("all"); }} options={[["all", "전체"], ...GRADES.map((g) => [String(g), `${g}학년`])]} />
              <select className="inp" style={{ width: "7rem" }} value={klass} onChange={(e) => setKlass(e.target.value)} aria-label="반">
                <option value="all">전체 반</option>
                {classes.map((k) => <option key={k} value={k}>{k}반</option>)}
              </select>
              <input type="search" className="inp" style={{ flex: "1 1 10rem" }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름 또는 2-3-" />
              <label className="flex items-center gap-1.5" style={{ fontSize: "0.85rem" }}>
                <input type="checkbox" checked={allOn} disabled={!pickable.length}
                  onChange={() => setPicked((p) => { const n = new Set(p); pickable.forEach((r) => (allOn ? n.delete(r.id) : n.add(r.id))); return n; })} />
                보이는 학생 모두
              </label>
            </div>
            <div className="pick-grid">
              {shown.slice(0, 400).map((r) => {
                const isTaken = taken.has(studentKey(r.grade, r.klass, r.number));
                return (
                  <label key={r.id} className={`pick ${picked.has(r.id) ? "on" : ""} ${isTaken ? "taken" : ""}`}>
                    <input type="checkbox" checked={isTaken || picked.has(r.id)} disabled={isTaken} onChange={() => toggle(r.id)} />
                    <span className="num faint">{r.grade}-{r.klass}-{r.number}</span>
                    <span className="truncate">{displayName(r.name, r.koreanName)}</span>
                  </label>
                );
              })}
            </div>
            {shown.length > 400 && <p className="field-hint">학년·반을 골라 범위를 좁혀 주세요({shown.length}명 중 400명만 보입니다).</p>}
          </div>
        )}
      </Modal>
    );
  }

  // ---------- 배정 학생 수정: 인정 시간 + 수정 사유(필수) ----------
  function AssignEditor({ a, role, roles, canEdit, isAdmin, operator, term, onClose }) {
    const [hours, setHours] = useState(a.hours);
    const [reason, setReason] = useState("");
    const [roleKey, setRoleKey] = useState(a.roleKey);
    const [busy, setBusy] = useState(false);
    const changed = Number(hours) !== a.hours || roleKey !== a.roleKey;
    const p = periodOf(role, a.grade);

    const save = async () => {
      if (!changed) return onClose();
      if (!reason.trim()) return toast("수정 사유를 적어 주세요.", "danger");
      const nr = roles.find((r) => r.key === roleKey);
      const patch = { hours: Math.max(0, Number(hours) || 0), reason: reason.trim(), updatedAt: FieldValue.serverTimestamp(), updatedBy: operator };
      if (isAdmin && roleKey !== a.roleKey) Object.assign(patch, { roleKey, helperName: nr ? nr.name : "" });
      setBusy(true);
      try {
        const logId = `log_${Date.now()}`;
        await commitInChunks([
          (b) => b.update(db.collection(PATHS.students).doc(a.id), patch),
          (b) => b.set(db.collection(PATHS.logs).doc(logId), {
            id: logId, term, timestamp: new Date().toLocaleString("ko-KR"),
            studentId: a.id, roleKey: patch.roleKey || a.roleKey, roleName: (nr || role || {}).name || a.helperName || "",
            studentName: a.name, neisName: a.neisName, grade: a.grade, class: a.class, number: a.number,
            originalHours: a.hours, newHours: patch.hours, reason: patch.reason, operator,
          }),
        ]);
        toast("저장했습니다.");
        onClose();
      } catch (err) {
        console.error(err);
        toast("저장하지 못했습니다.", "danger");
      }
      setBusy(false);
    };
    const remove = async () => {
      if (!window.confirm(`${displayName(a.neisName, a.name)} 학생을 '${(role || {}).name || a.helperName}'에서 뺄까요?`)) return;
      await db.collection(PATHS.students).doc(a.id).delete();
      toast("배정에서 뺐습니다.");
      onClose();
    };

    return (
      <Modal title={displayName(a.neisName, a.name)} sub={`${classLabel(a.grade, a.class)} ${a.number}번 · ${(role || {}).name || a.helperName || "역할 없음"}`} onClose={onClose} width={480}
        footer={<>
          {isAdmin && canEdit && <IconBtn icon="trash" label="배정에서 빼기" ghost danger className="mr-auto" onClick={remove} />}
          {canEdit && <IconBtn icon="ok" label="저장" primary tipLeft disabled={busy || !changed} onClick={save} />}
        </>}>
        <div className="fields">
          <div className="role-facts" style={{ marginTop: 0 }}>
            <div><span className="faint">활동 기간</span><span className="num">{periodText(p)}</span></div>
            <div><span className="faint">처음 시간</span><span className="num">{a.originalHours}시간</span></div>
            {a.updatedBy && <div><span className="faint">마지막 수정</span><span>{a.updatedBy}</span></div>}
          </div>
          {isAdmin && canEdit && (
            <div><label className="field-label">역할</label>
              <select className="inp" value={roleKey} onChange={(e) => setRoleKey(e.target.value)}>
                {roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
              </select></div>
          )}
          <div>
            <label className="field-label">인정 시간 <span className="faint" style={{ fontWeight: 400 }}>(기간 안에서 실제로 한 시간)</span></label>
            <div className="flex items-center gap-2">
              <button type="button" disabled={!canEdit} onClick={() => setHours((h) => Math.max(0, Number(h) - 1))} className="btn btn-icon" aria-label="1시간 줄이기">−</button>
              <input type="number" min="0" disabled={!canEdit} className="inp num text-center" style={{ width: "4.5rem" }} value={hours} onChange={(e) => setHours(Math.max(0, Number(e.target.value)))} />
              <button type="button" disabled={!canEdit} onClick={() => setHours((h) => Number(h) + 1)} className="btn btn-icon" aria-label="1시간 늘리기">+</button>
              <span className="muted" style={{ fontSize: "0.8125rem" }}>시간</span>
            </div>
          </div>
          {a.reason && <div className="notice" style={{ fontSize: "0.85rem" }}><span className="faint">지난 사유</span> {a.reason}</div>}
          {canEdit ? (
            <div>
              <label className="field-label">수정 사유 <span style={{ color: "var(--danger)" }}>(필수)</span></label>
              <textarea rows="2" className="inp" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 3월 결석이 많아 2시간 단축" />
            </div>
          ) : (
            <p className="field-hint">이 역할의 담당 교사만 고칠 수 있습니다.</p>
          )}
        </div>
      </Modal>
    );
  }

  // ---------- 명단 점검 ----------
  function CheckModal({ issues, rosterCount, onClose }) {
    const [busy, setBusy] = useState(false);
    const fixable = issues.filter((i) => i.fix || i.dup);
    const apply = async (list) => {
      setBusy(true);
      try {
        await commitInChunks(list.map((i) => (b) => {
          const ref = db.collection(PATHS.students).doc(i.a.id);
          if (i.dup) return b.delete(ref);
          const r = i.fix;
          b.update(ref, { grade: r.grade, class: r.klass, number: r.number, rosterKey: studentKey(r.grade, r.klass, r.number), neisName: r.name, name: r.koreanName || r.name });
        }));
        toast(`${list.length}건을 고쳤습니다.`);
      } catch (err) {
        console.error(err);
        toast("고치지 못했습니다.", "danger");
      }
      setBusy(false);
    };
    return (
      <Modal title="명단 점검" sub="배정 학생의 학적·나이스 성명을 전교생 명단과 맞춰 봅니다." onClose={onClose} width={760}
        footer={fixable.length > 0 && <IconBtn icon="ok" label={`고칠 수 있는 ${fixable.length}건 모두 명단대로 고치기`} primary tipLeft disabled={busy} onClick={() => apply(fixable)} />}>
        {!rosterCount && <div className="notice notice-warn" style={{ marginBottom: "0.75rem" }}>전교생 명단이 없어 학적·이름은 점검하지 못했습니다.</div>}
        {issues.length === 0 ? <Empty title="문제가 없습니다." sub="모든 배정 학생이 전교생 명단과 일치합니다." /> : (
          <div style={{ margin: "0 -1.375rem -1.125rem" }}>
            <table className="data-table">
              <thead><tr><th>학생</th><th>점검</th><th>내용</th><th aria-label="고치기" /></tr></thead>
              <tbody>
                {issues.map((i, n) => (
                  <tr key={n}>
                    <td className="whitespace-nowrap"><span className="num muted">{i.a.grade}-{i.a.class}-{i.a.number}</span> <strong>{displayName(i.a.neisName, i.a.name)}</strong><div className="text-xs faint">{i.a.helperName}</div></td>
                    <td><span className={`badge ${i.type === "명단에 없음" || i.type === "역할 없음" ? "badge-danger" : "badge-warn"}`}>{i.type}</span></td>
                    <td className="muted" style={{ fontSize: "0.85rem" }}>{i.text}</td>
                    <td style={{ textAlign: "right" }}>{(i.fix || i.dup) && <IconBtn icon={i.dup ? "trash" : "ok"} label={i.dup ? "중복 지우기" : "명단대로 고치기"} small tipLeft disabled={busy} onClick={() => apply([i])} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    );
  }

  // ---------- 변경 이력 (관리자 확인) ----------
  function LogsModal({ logs, reviewer, onClose }) {
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
      <Modal title="변경 이력" sub={`${logs.length}건 · 미확인 ${open.length}건`} onClose={onClose} width={900}
        footer={open.length > 0 && <IconBtn icon="ok" label={ids.length ? `선택한 ${ids.length}건 관리자 확인` : "확인할 이력을 고르세요"} primary tipLeft disabled={!ids.length} onClick={confirmSelected} />}>
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
                      <div className="font-semibold">{displayName(l.neisName, l.studentName)}</div>
                      <div className="text-xs muted num">{l.grade ? `${l.grade}학년 ${l.class}반 ${l.number}번` : ""}{l.roleName ? ` · ${l.roleName}` : ""}</div>
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

  // ---------- 확인서: 역할 × 학년마다 1장, 확인자는 역할 담당 교사 ----------
  function HelpersCertModal({ roles, assigns, teachers, issues, onClose }) {
    const todayKey = window.GW.todayKey;
    const [confirmDate, setConfirmDate] = useState(todayKey());
    const [useStamp, setUseStamp] = useState(true);
    const [previewing, setPreviewing] = useState(false);
    const stampOf = useMemo(() => Object.fromEntries(teachers.map((t) => [t.id, t.stamp || ""])), [teachers]);
    const issueIds = useMemo(() => new Set(issues.map((i) => i.a.id)), [issues]);
    const fontOk = useMemo(() => (window.hasMalgun ? window.hasMalgun() : true), []);

    const groups = useMemo(() => {
      const out = [];
      roles.forEach((r) => GRADES.forEach((g) => {
        const students = assigns.filter((a) => a.roleKey === r.key && a.grade === g);
        if (!students.length) return;
        const p = periodOf(r, g);
        const warn = [
          !(p.start && p.end) && "기간 없음",
          !r.teacherName && "담당 교사 없음",
          !r.content && "활동 내용 없음",
          students.some((a) => issueIds.has(a.id)) && "명단 점검",
        ].filter(Boolean);
        out.push({ key: `${r.key}_${g}`, role: r, grade: g, students, period: p, warn });
      }));
      return out;
    }, [roles, assigns, issueIds]);
    const [excluded, setExcluded] = useState(() => new Set());
    const chosen = groups.filter((x) => !excluded.has(x.key));
    const allOn = chosen.length === groups.length;

    const pages = useMemo(() => chosen.flatMap((x) => window.buildCertPages(
      {
        helperName: x.key,
        students: x.students.map((a) => ({ grade: a.grade, class: a.class, number: a.number, name: a.name, neisName: a.neisName, hours: a.hours })),
        defaultContent: x.role.content,
      },
      { area: x.role.area, inCurriculum: false, content: x.role.content || "", teacher: x.role.teacherName || "", title: "교사", stamp: useStamp ? stampOf[x.role.teacherUid] || "" : "" },
      confirmDate,
      { start: x.period.start, end: x.period.end }
    )), [chosen, confirmDate, useStamp, stampOf]);

    const print = async () => {
      if (!pages.length) return toast("출력할 확인서를 고르세요.", "danger");
      const warnCount = chosen.filter((x) => x.warn.length).length;
      if (warnCount && !window.confirm(`확인이 필요한 확인서가 ${warnCount}장 있습니다. 그대로 출력할까요?`)) return;
      const prev = document.title;
      document.title = "단체봉사활동 실시 확인서";
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      window.print();
      document.title = prev;
    };
    const printRoot = document.getElementById("cert-print-root");

    return (
      <>
        <Modal title="확인서 출력" sub={`역할 × 학년마다 1장 · ${pages.length}쪽 · 인쇄 창에서 "PDF로 저장"을 고르면 PDF가 됩니다.`} onClose={onClose} width={960}
          footer={<>
            <IconBtn icon={previewing ? "eyeOff" : "eye"} label={previewing ? "미리보기 닫기" : "미리보기"} className="mr-auto" onClick={() => setPreviewing((v) => !v)} />
            <IconBtn icon="printer" label="PDF 저장 / 인쇄" primary tipLeft onClick={print} />
          </>}>
          <div className="fields">
            {!fontOk && <div className="notice notice-danger">이 컴퓨터에는 맑은 고딕이 없어서 글자 폭과 줄바꿈이 원본 양식과 달라집니다. 맑은 고딕이 있는 Windows PC에서 출력하세요.</div>}
            <div className="flex flex-wrap items-end gap-3">
              <div><label className="field-label">확인 날짜</label><input type="date" className="inp" style={{ width: "11rem" }} value={confirmDate} onChange={(e) => setConfirmDate(e.target.value)} /></div>
              <label className="flex items-center gap-2" style={{ fontSize: "0.875rem", paddingBottom: "0.55rem" }}>
                <span className="ios-switch" style={{ transform: "scale(0.8)" }}><input type="checkbox" checked={useStamp} onChange={(e) => setUseStamp(e.target.checked)} /><span /></span>
                도장 넣기
              </label>
            </div>
            <div className="card" style={{ overflow: "hidden", boxShadow: "none", background: "var(--fill)" }}>
              <table className="data-table">
                <thead><tr>
                  <th style={{ width: "2.5rem" }}><input type="checkbox" aria-label="모두 고르기" checked={allOn} onChange={() => setExcluded(allOn ? new Set(groups.map((x) => x.key)) : new Set())} /></th>
                  <th>역할</th><th>학년</th><th className="hidden sm:table-cell">기간</th><th>확인자</th><th>도장</th><th style={{ textAlign: "right" }}>인원</th><th className="hidden md:table-cell">확인할 점</th>
                </tr></thead>
                <tbody>
                  {groups.map((x) => (
                    <tr key={x.key} style={{ opacity: excluded.has(x.key) ? 0.5 : 1 }}>
                      <td><input type="checkbox" checked={!excluded.has(x.key)} onChange={() => setExcluded((p) => { const n = new Set(p); n.has(x.key) ? n.delete(x.key) : n.add(x.key); return n; })} aria-label={`${x.role.name} ${x.grade}학년`} /></td>
                      <td className="font-semibold">{x.role.name}</td>
                      <td className="num">{x.grade}학년</td>
                      <td className="hidden sm:table-cell num muted whitespace-nowrap">{periodText(x.period)}</td>
                      <td>{x.role.teacherName || <span className="faint">–</span>}</td>
                      <td>{stampOf[x.role.teacherUid] ? <img src={stampOf[x.role.teacherUid]} alt="도장" style={{ height: "1.6rem" }} /> : <span className="faint">–</span>}</td>
                      <td className="num" style={{ textAlign: "right" }}>{x.students.length}명</td>
                      <td className="hidden md:table-cell">{x.warn.map((w) => <span key={w} className="badge badge-warn mr-1">{w}</span>)}</td>
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

  Object.assign(window.GW, { HelpersPage });
})();
