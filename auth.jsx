// 로그인 · 가입 신청 · 승인 대기 · 교사 관리(관리자)
(function () {
  const { useState, useMemo } = React;
  const { db, auth, FieldValue, CONTACT, toInt, classLabel, fmtTime, toast,
    Icon, Inspector, PageHead, Empty, Seg, GradeClassSelect } = window.GW;

  const GoogleMark = () => (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );

  function AuthShell({ children, sub }) {
    return (
      <div className="auth-wrap">
        <div className="card auth-card">
          <div className="auth-head">
            <img src="logo.png" alt="" className="auth-logo" onError={(e) => { e.target.style.display = "none"; }} />
            <div className="auth-word">봉사활동 관리</div>
            <div className="auth-sub">{sub || "관산중학교"}</div>
          </div>
          {children}
        </div>
      </div>
    );
  }

  const Contact = ({ children }) => (
    <div className="contact">
      {children || "처음 쓰시거나 접속이 안 되면"} <strong>{CONTACT.who}</strong>께 {CONTACT.how}로 연락해 주세요.
    </div>
  );

  function LoginScreen() {
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const signIn = async () => {
      setBusy(true);
      setError("");
      try {
        await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
      } catch (err) {
        console.error("구글 로그인 실패:", err);
        if (err.code !== "auth/popup-closed-by-user" && err.code !== "auth/cancelled-popup-request") {
          setError("Google 로그인에 실패했습니다. 다시 시도해 주세요.");
        }
      }
      setBusy(false);
    };
    return (
      <AuthShell>
        <button onClick={signIn} disabled={busy} className="btn btn-block google-btn">
          <GoogleMark /> Google 계정으로 로그인
        </button>
        {error && <p className="field-error text-center">{error}</p>}
        <p className="text-center muted" style={{ fontSize: "0.8125rem", marginTop: "0.875rem" }}>
          처음 로그인하면 이름과 담임 학급을 적어 가입 신청을 합니다.<br />담당 선생님이 승인하면 쓸 수 있습니다.
        </p>
        <Contact />
      </AuthShell>
    );
  }

  // 가입 신청 / 승인 대기 / 거절. teacher: teachers/{uid} 문서(없으면 null)
  function ApplyScreen({ user, teacher }) {
    const [editing, setEditing] = useState(!teacher);
    const [name, setName] = useState(teacher?.name || user.displayName || "");
    const [homeroom, setHomeroom] = useState(teacher ? !!teacher.homeroom : true);
    const [grade, setGrade] = useState(teacher?.grade || null);
    const [klass, setKlass] = useState(teacher?.klass || null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);

    const submit = async (e) => {
      e.preventDefault();
      if (!name.trim()) return setError("이름을 입력하세요.");
      if (homeroom && (!grade || !klass)) return setError("담임 학급(학년·반)을 고르세요.");
      setBusy(true);
      try {
        const data = {
          name: name.trim(),
          email: user.email,
          homeroom,
          status: "pending",
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (homeroom) Object.assign(data, { grade, klass });
        if (!teacher) data.createdAt = FieldValue.serverTimestamp();
        // 담임이 아니게 바뀌면 예전 학급 값을 지운다.
        await db.collection("teachers").doc(user.uid).set(
          homeroom ? data : { ...data, grade: FieldValue.delete(), klass: FieldValue.delete() },
          { merge: true }
        );
        setEditing(false);
      } catch (err) {
        console.error("가입 신청 실패:", err);
        setError("신청을 저장하지 못했습니다. 잠시 후 다시 시도하세요.");
      }
      setBusy(false);
    };

    const who = <p className="text-center muted" style={{ fontSize: "0.8125rem", margin: "0 0 1rem" }}>{user.email}</p>;
    const signOut = <button onClick={() => auth.signOut()} className="btn btn-ghost btn-sm">다른 계정으로 로그인</button>;

    if (!editing && teacher) {
      const rejected = teacher.status === "rejected";
      return (
        <AuthShell sub={rejected ? "승인되지 않았습니다" : "승인을 기다리는 중입니다"}>
          {who}
          <div className="notice" style={{ fontSize: "0.875rem" }}>
            <div><span className="muted">이름</span> <strong>{teacher.name}</strong></div>
            <div><span className="muted">담임</span> <strong>{teacher.homeroom ? classLabel(teacher.grade, teacher.klass) : "비담임"}</strong></div>
          </div>
          <Contact>{rejected ? "신청 내용을 고쳐 다시 신청하거나" : "승인이 늦어지면"}</Contact>
          <div className="flex justify-center gap-2 mt-4">
            <button onClick={() => setEditing(true)} className="btn btn-sm">{rejected ? "다시 신청" : "신청 내용 고치기"}</button>
            {signOut}
          </div>
        </AuthShell>
      );
    }

    return (
      <AuthShell sub="가입 신청">
        {who}
        <form onSubmit={submit} className="fields">
          <div>
            <label className="field-label" htmlFor="ap-name">이름</label>
            <input id="ap-name" className="inp" value={name} onChange={(e) => { setName(e.target.value); setError(""); }} maxLength={30} autoFocus />
            <p className="field-hint">확인서의 확인자 칸에 이 이름이 들어갑니다.</p>
          </div>
          <div>
            <span className="field-label">담임</span>
            <Seg value={homeroom ? "y" : "n"} options={[["y", "담임"], ["n", "비담임"]]} onChange={(v) => { setHomeroom(v === "y"); setError(""); }} />
          </div>
          {homeroom && (
            <div>
              <span className="field-label">담임 학급</span>
              <GradeClassSelect grade={grade} klass={klass} onChange={(g, k) => { setGrade(g); setKlass(k); setError(""); }} />
            </div>
          )}
          {error && <p className="field-error" style={{ marginTop: 0 }}>{error}</p>}
          <button type="submit" disabled={busy} className="btn btn-primary btn-block">{teacher ? "다시 신청" : "가입 신청"}</button>
        </form>
        <div className="flex justify-center gap-2 mt-3">
          {teacher && <button onClick={() => setEditing(false)} className="btn btn-ghost btn-sm">취소</button>}
          {signOut}
        </div>
        <Contact>승인이 필요하면</Contact>
      </AuthShell>
    );
  }

  // ---------- 교사 관리(관리자) ----------
  const STATUS = {
    pending: ["승인 대기", "badge-warn"],
    approved: ["승인", "badge-ok"],
    rejected: ["거절", "badge-danger"],
  };

  function TeachersPage({ teachers }) {
    const [filter, setFilter] = useState("pending");
    const [selId, setSelId] = useState(null);
    const list = teachers || [];
    const pending = list.filter((t) => t.status === "pending").length;
    const shown = useMemo(() => {
      const rows = filter === "all" ? list : list.filter((t) => t.status === filter);
      return [...rows].sort((a, b) =>
        (a.homeroom === b.homeroom ? 0 : a.homeroom ? -1 : 1) ||
        ((a.grade || 99) - (b.grade || 99)) || ((a.klass || 99) - (b.klass || 99)) ||
        String(a.name).localeCompare(String(b.name), "ko"));
    }, [list, filter]);
    const sel = list.find((t) => t.id === selId) || null;

    // 같은 학급에 승인된 담임이 둘 이상이면 표시
    const dupClass = useMemo(() => {
      const m = new Map();
      list.filter((t) => t.status === "approved" && t.homeroom).forEach((t) => {
        const k = `${t.grade}-${t.klass}`;
        m.set(k, (m.get(k) || 0) + 1);
      });
      return new Set([...m].filter(([, n]) => n > 1).map(([k]) => k));
    }, [list]);

    return (
      <>
        <PageHead title="교사 관리" sub={`가입한 교사 ${list.length}명${pending ? ` · 승인 대기 ${pending}명` : ""}`} />
        <div className="split">
          <div className="card min-w-0" style={{ overflow: "hidden" }}>
            <div className="toolbar" style={{ borderBottom: "0.5px solid var(--hairline)" }}>
              <Seg value={filter} onChange={setFilter} options={[["pending", `승인 대기 ${pending}`], ["approved", "승인"], ["rejected", "거절"], ["all", "전체"]]} />
            </div>
            {shown.length === 0 ? (
              <Empty title={filter === "pending" ? "승인을 기다리는 신청이 없습니다." : "해당하는 교사가 없습니다."} />
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>이름</th>
                    <th>담임 학급</th>
                    <th className="col-wide">이메일</th>
                    <th>상태</th>
                    <th className="col-xwide">신청</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((t) => (
                    <tr key={t.id} className={`row-open ${selId === t.id ? "selected" : ""}`} tabIndex={0}
                      onClick={() => setSelId(t.id)} onKeyDown={(e) => e.key === "Enter" && setSelId(t.id)}>
                      <td className="font-semibold">{t.name}</td>
                      <td className="num whitespace-nowrap">
                        {t.homeroom ? classLabel(t.grade, t.klass) : <span className="faint">비담임</span>}
                        {t.homeroom && t.status === "approved" && dupClass.has(`${t.grade}-${t.klass}`) && <span className="badge badge-warn ml-1">중복</span>}
                      </td>
                      <td className="col-wide muted">{t.email}</td>
                      <td><span className={`badge ${STATUS[t.status]?.[1] || ""}`}>{STATUS[t.status]?.[0] || t.status}</span></td>
                      <td className="col-xwide muted num">{fmtTime(t.updatedAt || t.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <TeacherEditor key={sel ? sel.id : "none"} t={sel} onClose={() => setSelId(null)} />
        </div>
      </>
    );
  }

  function TeacherEditor({ t, onClose }) {
    const [name, setName] = useState(t?.name || "");
    const [homeroom, setHomeroom] = useState(!!t?.homeroom);
    const [grade, setGrade] = useState(t?.grade || null);
    const [klass, setKlass] = useState(t?.klass || null);
    const [busy, setBusy] = useState(false);

    const save = async (status) => {
      if (!name.trim()) return toast("이름을 입력하세요.", "danger");
      if (homeroom && (!grade || !klass)) return toast("담임 학급을 고르세요.", "danger");
      setBusy(true);
      try {
        await db.collection("teachers").doc(t.id).set({
          name: name.trim(),
          homeroom,
          grade: homeroom ? grade : FieldValue.delete(),
          klass: homeroom ? klass : FieldValue.delete(),
          status,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        toast(status === "approved" ? `${name} 선생님을 승인했습니다.` : status === "rejected" ? "거절했습니다." : "저장했습니다.");
      } catch (err) {
        console.error(err);
        toast("저장하지 못했습니다.", "danger");
      }
      setBusy(false);
    };
    const remove = async () => {
      if (!window.confirm(`${t.name} 선생님의 가입 정보를 지울까요? 다시 로그인하면 새로 신청하게 됩니다.`)) return;
      await db.collection("teachers").doc(t.id).delete();
      toast("지웠습니다.");
      onClose();
    };

    return (
      <Inspector
        open={!!t}
        title={t ? t.name : ""}
        sub={t ? t.email : ""}
        onClose={onClose}
        placeholder={
          <div className="panel-body" style={{ paddingTop: "1.25rem" }}>
            <div className="card-title" style={{ marginBottom: "0.5rem" }}>승인 방법</div>
            <ol className="muted" style={{ fontSize: "0.875rem", paddingLeft: "1.1rem", margin: 0, listStyle: "decimal" }}>
              <li>선생님이 Google로 로그인해 이름과 담임 학급을 적어 신청합니다.</li>
              <li>여기서 줄을 눌러 학급을 확인하고 승인합니다.</li>
              <li>담임은 자기 반 명단·출결만, 비담임은 교육과정 외 도우미만 다룰 수 있습니다.</li>
            </ol>
          </div>
        }
        footer={t && (
          <>
            <button onClick={remove} className="btn btn-ghost btn-danger mr-auto" disabled={busy}>삭제</button>
            {t.status !== "rejected" && <button onClick={() => save("rejected")} className="btn" disabled={busy}>거절</button>}
            <button onClick={() => save("approved")} className="btn btn-primary" disabled={busy}>{t.status === "approved" ? "저장" : "승인"}</button>
          </>
        )}
      >
        {t && (
          <div className="fields">
            <div>
              <span className={`badge ${STATUS[t.status]?.[1] || ""}`}>{STATUS[t.status]?.[0]}</span>
            </div>
            <div>
              <label className="field-label">이름</label>
              <input className="inp" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} />
            </div>
            <div>
              <span className="field-label">담임</span>
              <Seg value={homeroom ? "y" : "n"} options={[["y", "담임"], ["n", "비담임"]]} onChange={(v) => setHomeroom(v === "y")} />
            </div>
            {homeroom && (
              <div>
                <span className="field-label">담임 학급</span>
                <GradeClassSelect grade={grade} klass={klass} onChange={(g, k) => { setGrade(g); setKlass(k); }} />
              </div>
            )}
          </div>
        )}
      </Inspector>
    );
  }

  Object.assign(window.GW, { LoginScreen, ApplyScreen, TeachersPage });
})();
