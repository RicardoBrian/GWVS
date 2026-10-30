// 앱 틀: 로그인 상태 · 역할 · 메뉴(사이드바/상단 바/하단 탭바) · 화면 전환(#주소)
(function () {
  const { useState, useEffect } = React;
  const { db, auth, PATHS, classLabel, useCollection, Icon, IconBtn, Toast,
    LoginScreen, StampModal, ApplyScreen, TeachersPage, HelpersPage, RosterPage, AttendancePage, EventsPage } = window.GW;

  const parseHash = () => {
    const [sec, a, b] = decodeURIComponent(location.hash.replace(/^#/, "")).split("/");
    return { sec: sec || "", a: a || "", b: b || "" };
  };
  const go = (hash) => { if (location.hash !== hash) location.hash = hash; };
  const byDateDesc = (list) => [...list].sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.title).localeCompare(String(b.title), "ko"));

  function useTheme() {
    const [isDark, setIsDark] = useState(() => {
      try {
        const saved = localStorage.getItem("portal_theme");
        if (saved) return saved === "dark";
      } catch (e) {}
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    });
    useEffect(() => {
      document.documentElement.classList.toggle("dark", isDark);
      try { localStorage.setItem("portal_theme", isDark ? "dark" : "light"); } catch (e) {}
    }, [isDark]);
    return [isDark, setIsDark];
  }

  const Splash = () => <div className="auth-wrap muted">불러오는 중…</div>;

  function App() {
    const [user, setUser] = useState(undefined);   // undefined: 확인 중, null: 로그아웃
    const [isAdmin, setIsAdmin] = useState(null);
    const [teacher, setTeacher] = useState(undefined);
    const [route, setRoute] = useState(parseHash);
    const theme = useTheme();

    useEffect(() => {
      const on = () => setRoute(parseHash());
      window.addEventListener("hashchange", on);
      return () => window.removeEventListener("hashchange", on);
    }, []);

    useEffect(() => auth.onAuthStateChanged(async (u) => {
      // 예전 공용 비밀번호 방식의 익명 로그인이 남아 있으면 끊는다.
      if (u && u.isAnonymous) { await auth.signOut(); return; }
      setIsAdmin(null);
      setTeacher(undefined);
      setUser(u || null);
      if (!u) return;
      try {
        const snap = await db.collection("admins").doc(u.email).get();
        setIsAdmin(snap.exists);
      } catch (err) {
        setIsAdmin(false);
      }
    }), []);

    useEffect(() => {
      if (!user) return;
      return db.collection("teachers").doc(user.uid).onSnapshot(
        (snap) => setTeacher(snap.exists ? { id: snap.id, ...snap.data() } : null),
        (err) => { console.error("교사 정보 수신 실패:", err); setTeacher(null); }
      );
    }, [user]);

    let body;
    if (user === undefined) body = <Splash />;
    else if (user === null) body = <LoginScreen />;
    else if (isAdmin === null || teacher === undefined) body = <Splash />;
    else if (!isAdmin && !(teacher && teacher.status === "approved")) body = <ApplyScreen user={user} teacher={teacher} />;
    else body = <Portal user={user} isAdmin={isAdmin} teacher={teacher} route={route} theme={theme} />;

    return <>{body}<Toast /></>;
  }

  function Portal({ user, isAdmin, teacher, route, theme }) {
    const [isDark, setIsDark] = theme;
    const approved = teacher && teacher.status === "approved";
    const homeroom = approved && teacher.homeroom && teacher.grade && teacher.klass ? { grade: teacher.grade, klass: teacher.klass } : null;
    const canClass = isAdmin || !!homeroom;
    const roster = useCollection(canClass ? PATHS.roster : null);
    const events = useCollection(canClass ? PATHS.events : null, byDateDesc);
    const teachers = useCollection(isAdmin ? "teachers" : null);
    const pending = (teachers || []).filter((t) => t.status === "pending").length;
    const me = (teacher && teacher.name) || user.displayName || user.email;
    const roleText = isAdmin ? "관리자" : homeroom ? `${classLabel(homeroom.grade, homeroom.klass)} 담임` : "교사";

    const nav = [
      { id: "helpers", label: "교육과정 외 봉사", short: "교육과정 외", icon: "hands", group: "봉사활동" },
      canClass && { id: "attendance", label: "교육과정 내 봉사", short: "교육과정 내", icon: "check", group: "봉사활동" },
      canClass && { id: "roster", label: "학급 명단", short: "명단", icon: "roster", group: "봉사활동" },
      isAdmin && { id: "events", label: "활동 · 현황판", short: "활동", icon: "events", group: "관리" },
      isAdmin && { id: "teachers", label: "교사 관리", short: "교사", icon: "teachers", group: "관리", count: pending },
    ].filter(Boolean);
    const sec = nav.some((n) => n.id === route.sec) ? route.sec : isAdmin ? "events" : homeroom ? "attendance" : "helpers";
    const groups = [...new Set(nav.map((n) => n.group))];
    const [stampOpen, setStampOpen] = useState(false);

    const logout = async () => {
      await auth.signOut();
      history.replaceState(null, "", location.pathname);
    };

    let page;
    if (sec === "helpers") page = <HelpersPage isAdmin={isAdmin} operator={`${me} (${roleText})`} />;
    else if (sec === "attendance") page = <AttendancePage isAdmin={isAdmin} homeroom={homeroom} me={me} myStamp={(teacher && teacher.stamp) || ""} roster={roster} events={events} route={{ eventId: route.a, cls: route.b }} go={go} />;
    else if (sec === "roster") page = <RosterPage key={isAdmin ? "a" : route.a} isAdmin={isAdmin} homeroom={homeroom} roster={roster} route={{ cls: route.a }} go={go} />;
    else if (sec === "events") page = <EventsPage roster={roster} events={events} teachers={teachers} route={{ eventId: route.a }} go={go} />;
    else if (sec === "teachers") page = <TeachersPage teachers={teachers} />;

    const brand = (
      <div className="brand">
        <img src="logo.png" alt="" onError={(e) => { e.target.style.display = "none"; }} />
        <div className="min-w-0">
          <div className="brand-title">봉사활동 관리</div>
          <div className="brand-sub">관산중학교</div>
        </div>
      </div>
    );

    return (
      <div>
        <nav className="sidebar" aria-label="메뉴">
          {brand}
          <div className="side-menu">
            {groups.map((gname) => (
              <div key={gname}>
                <div className="side-head">{gname}</div>
                {nav.filter((n) => n.group === gname).map((n) => (
                  <button key={n.id} className={`side-item ${sec === n.id ? "on" : ""}`} aria-current={sec === n.id ? "page" : undefined} onClick={() => go(`#${n.id}`)}>
                    <Icon name={n.icon} />{n.label}
                    {n.count > 0 && <span className="count">{n.count}</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="side-foot">
            <div className="min-w-0">
              <div className="font-semibold truncate" style={{ fontSize: "0.875rem" }}>{me}</div>
              <div className="faint truncate" style={{ fontSize: "0.75rem" }}>{roleText} · {user.email}</div>
            </div>
            <div className="flex items-center gap-1.5">
              {teacher && <IconBtn icon="stamp" label="내 도장" small onClick={() => setStampOpen(true)} />}
              <IconBtn icon={isDark ? "sun" : "moon"} label={isDark ? "밝은 화면" : "어두운 화면"} small onClick={() => setIsDark((d) => !d)} />
              <IconBtn icon="logout" label="로그아웃" small onClick={logout} />
            </div>
          </div>
        </nav>

        <header className="topbar">
          {brand}
          <span className="badge ml-auto">{roleText}</span>
          {teacher && <IconBtn icon="stamp" label="내 도장" small ghost tipLeft onClick={() => setStampOpen(true)} />}
          <IconBtn icon={isDark ? "sun" : "moon"} label={isDark ? "밝은 화면" : "어두운 화면"} small ghost tipLeft onClick={() => setIsDark((d) => !d)} />
          <IconBtn icon="logout" label="로그아웃" small ghost tipLeft onClick={logout} />
        </header>

        <main className="main">
          <div className="page">{page}</div>
        </main>

        {stampOpen && teacher && <StampModal uid={teacher.id} name={me} stamp={teacher.stamp || ""} onClose={() => setStampOpen(false)} />}
        {nav.length > 1 && (
          <nav className="tabbar" aria-label="메뉴">
            {nav.map((n) => (
              <button key={n.id} className={`tab ${sec === n.id ? "on" : ""}`} aria-current={sec === n.id ? "page" : undefined} onClick={() => go(`#${n.id}`)}>
                <Icon name={n.icon} size={20} />
                <span>{n.short}</span>
                {n.count > 0 && <span className="count">{n.count}</span>}
              </button>
            ))}
          </nav>
        )}
      </div>
    );
  }

  ReactDOM.createRoot(document.getElementById("root")).render(<App />);
})();
