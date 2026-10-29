// 공통: Firebase 연결, 데이터 경로, 작은 도우미 함수, 화면 부품
// 다른 화면 파일은 window.GW 에서 꺼내 쓴다.
(function () {
  const { useState, useEffect, useRef } = React;

  const firebaseConfig = {
    apiKey: "AIzaSyC0M-QpErLS_haeexoymRiZ8l0tdC_SRgg",
    authDomain: "gwvs-77114.firebaseapp.com",
    projectId: "gwvs-77114",
    storageBucket: "gwvs-77114.firebasestorage.app",
    messagingSenderId: "1044148704527",
    appId: "1:1044148704527:web:e16e00ebb440a4b70e9a7a",
  };
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const db = firebase.firestore();
  const auth = firebase.auth();
  const FieldValue = firebase.firestore.FieldValue;

  // 접속·승인 문의처. 로그인·승인 대기 화면에 그대로 나온다.
  const CONTACT = {
    who: "봉사활동 담당 선생님",
    how: "교내 메신저",
  };

  const APP_ID = "volunteer-portal-gwvs";
  const DATA = `artifacts/${APP_ID}/public/data`;
  const PATHS = {
    students: `${DATA}/students`,      // 교육과정 외: 도우미 명단
    logs: `${DATA}/logs`,              // 교육과정 외: 인정 시간 변경 이력
    certSettings: `${DATA}/settings/certificate`,
    roster: `${DATA}/roster`,          // 전교생 명단 (문서 ID = 학년-반-번호)
    events: `${DATA}/events`,          // 교육과정 내 활동
    attendance: `${DATA}/attendance`,  // 활동별·학급별 불참 학생 (문서 ID = 활동ID_학년-반)
  };

  const AREAS = ["이웃돕기활동", "환경보호활동", "캠페인활동"];
  const GRADES = [1, 2, 3];
  const MAX_CLASS = 15;
  const PERIODS = [1, 2, 3, 4, 5, 6, 7];

  // ---------- 값 다루기 ----------
  const toInt = (v) => {
    const n = parseInt(String(v ?? "").replace(/[^\d-]/g, ""), 10);
    return Number.isNaN(n) ? null : n;
  };
  const classKey = (g, k) => `${g}-${k}`;
  const classLabel = (g, k) => `${g}학년 ${k}반`;
  const rosterId = (g, k, n) => `${g}-${k}-${n}`;
  const attendanceId = (eventId, g, k) => `${eventId}_${g}-${k}`;
  const byGradeClassNo = (a, b) =>
    (a.grade - b.grade) || ((a.klass ?? a.class) - (b.klass ?? b.class)) || (a.number - b.number);

  const pad2 = (n) => String(n).padStart(2, "0");
  const todayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  };
  const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
  const fmtDate = (key, withYear) => {
    const m = String(key || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return key || "";
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return `${withYear ? m[1] + "년 " : ""}${+m[2]}월 ${+m[3]}일 (${WEEK[d.getDay()]})`;
  };
  const fmtPeriods = (e) =>
    e.periodStart && e.periodEnd && e.periodStart !== e.periodEnd
      ? `${e.periodStart}–${e.periodEnd}교시`
      : e.periodStart ? `${e.periodStart}교시` : "";
  const fmtTime = (ts) => {
    const d = ts && ts.toDate ? ts.toDate() : null;
    if (!d) return "";
    return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  };

  // ---------- 파일 ----------
  // 엑셀에서 저장한 CSV는 EUC-KR(CP949)인 경우가 많다. UTF-8로 안 읽히면 EUC-KR로 다시 읽는다.
  async function readTextFile(file) {
    const buf = await file.arrayBuffer();
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, "");
    } catch (e) {
      return new TextDecoder("euc-kr").decode(buf);
    }
  }

  function downloadCsv(filename, header, rows) {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const text = [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Firestore 일괄 쓰기는 한 번에 500건까지라 나눠서 보낸다.
  async function commitInChunks(ops) {
    for (let i = 0; i < ops.length; i += 450) {
      const batch = db.batch();
      ops.slice(i, i + 450).forEach((op) => op(batch));
      await batch.commit();
    }
  }

  // ---------- 토스트 ----------
  const toast = (msg, type = "success") =>
    window.dispatchEvent(new CustomEvent("gw-toast", { detail: { msg, type } }));

  function Toast() {
    const [t, setT] = useState(null);
    useEffect(() => {
      let timer;
      const on = (e) => {
        setT(e.detail);
        clearTimeout(timer);
        timer = setTimeout(() => setT(null), 3000);
      };
      window.addEventListener("gw-toast", on);
      return () => { window.removeEventListener("gw-toast", on); clearTimeout(timer); };
    }, []);
    return t ? <div className={`toast ${t.type === "danger" ? "danger" : ""}`} role="status">{t.msg}</div> : null;
  }

  // ---------- 훅 ----------
  function useMedia(query) {
    const [on, setOn] = useState(() => window.matchMedia(query).matches);
    useEffect(() => {
      const mq = window.matchMedia(query);
      const fn = () => setOn(mq.matches);
      mq.addEventListener ? mq.addEventListener("change", fn) : mq.addListener(fn);
      return () => (mq.removeEventListener ? mq.removeEventListener("change", fn) : mq.removeListener(fn));
    }, [query]);
    return on;
  }
  const useWide = () => useMedia("(min-width: 1280px)");

  // 컬렉션을 실시간으로 받는다. path가 비어 있으면 받지 않는다.
  function useCollection(path, map) {
    const [items, setItems] = useState(null);
    useEffect(() => {
      if (!path) { setItems(null); return; }
      return db.collection(path).onSnapshot(
        (snap) => setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        (err) => { console.error(path, err); setItems([]); }
      );
    }, [path]);
    return items && map ? map(items) : items;
  }

  // ---------- 아이콘 ----------
  const ICONS = {
    hands: <><path d="M7 11V7a2 2 0 1 1 4 0v4" /><path d="M11 10V5a2 2 0 1 1 4 0v5" /><path d="M15 10V7a2 2 0 1 1 4 0v7a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.6-2.8L3 14.5a2 2 0 0 1 3-2.6L7 13" /></>,
    check: <><rect x="3" y="4" width="18" height="17" rx="3" /><path d="M8 2v4M16 2v4M3 10h18" /><path d="M9 15l2 2 4-4" /></>,
    roster: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><circle cx="17.5" cy="9" r="2.5" /><path d="M16 14.2a5 5 0 0 1 6 4.8" /></>,
    events: <><path d="M4 5h16M4 12h16M4 19h10" /></>,
    teachers: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /><path d="M16 4l2 2 3-3" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
    moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
    logout: <><path d="M15 3h3a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-3" /><path d="M10 17l5-5-5-5M15 12H3" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
    more: <><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></>,
    close: <path d="M6 6l12 12M18 6L6 18" />,
    back: <path d="M15 5l-7 7 7 7" />,
    printer: <><path d="M6 9V3h12v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M6 14h12v7H6z" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></>,
    download: <><path d="M12 4v12M7 11l5 5 5-5" /><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></>,
  };
  const Icon = ({ name, size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );

  // ---------- 화면 부품 ----------
  function Modal({ title, sub, onClose, children, footer, width = 560 }) {
    useEffect(() => {
      const onKey = (e) => e.key === "Escape" && onClose && onClose();
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);
    return (
      <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>
        <div className="modal" style={{ maxWidth: width }} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}>
          <div className="modal-head">
            <div className="min-w-0">
              <h3>{title}</h3>
              {sub && <p className="muted" style={{ fontSize: "0.8125rem", margin: "0.15rem 0 0" }}>{sub}</p>}
            </div>
            {onClose && (
              <button type="button" onClick={onClose} className="btn btn-sm btn-ghost btn-icon" aria-label="닫기"><Icon name="close" size={16} /></button>
            )}
          </div>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-foot">{footer}</div>}
        </div>
      </div>
    );
  }

  // 넓은 화면(≥1280)에서는 오른쪽 고정 패널, 그보다 좁으면 팝업(휴대폰은 아래 시트)으로 보인다.
  // 넓은 화면에서 open=false면 placeholder(요약 등)를 대신 보여 준다.
  function Inspector({ open, title, sub, onClose, children, footer, placeholder, modal }) {
    const wide = useWide();
    if (wide && !modal) {
      if (!open) return placeholder ? <aside className="panel card">{placeholder}</aside> : <aside className="panel" />;
      return (
        <aside className="panel card">
          <div className="panel-head">
            <div className="min-w-0">
              <h3>{title}</h3>
              {sub && <p className="muted" style={{ fontSize: "0.8125rem", margin: "0.15rem 0 0" }}>{sub}</p>}
            </div>
            {onClose && <button type="button" onClick={onClose} className="btn btn-sm btn-ghost btn-icon" aria-label="닫기"><Icon name="close" size={16} /></button>}
          </div>
          <div className="panel-body">{children}</div>
          {footer && <div className="panel-foot">{footer}</div>}
        </aside>
      );
    }
    if (!open) return null;
    return <Modal title={title} sub={sub} onClose={onClose} footer={footer} width={520}>{children}</Modal>;
  }

  function PageHead({ title, sub, actions, back }) {
    return (
      <div className="page-head">
        {back && <button onClick={back} className="btn btn-sm btn-icon" aria-label="뒤로" style={{ marginBottom: 4 }}><Icon name="back" size={16} /></button>}
        <div className="min-w-0">
          <h1>{title}</h1>
          {sub && <p>{sub}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
    );
  }

  function Empty({ title, sub, children }) {
    return (
      <div className="empty">
        <strong>{title}</strong>
        {sub && <p>{sub}</p>}
        {children && <div style={{ marginTop: "1rem" }}>{children}</div>}
      </div>
    );
  }

  function Stat({ label, value, unit }) {
    return (
      <div className="card stat">
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}{unit && <small>{unit}</small>}</div>
      </div>
    );
  }

  // ⋯ 버튼을 누르면 펼쳐지는 메뉴. items: [{label, onClick, danger, file(accept)}, "-"]
  function MoreMenu({ items, label = "더 보기" }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    useEffect(() => {
      if (!open) return;
      const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
      document.addEventListener("mousedown", close);
      return () => document.removeEventListener("mousedown", close);
    }, [open]);
    return (
      <div className="menu-wrap" ref={ref}>
        <button className="btn btn-icon" onClick={() => setOpen((v) => !v)} aria-label={label} aria-expanded={open}><Icon name="more" /></button>
        {open && (
          <div className="menu" role="menu">
            {items.filter(Boolean).map((it, i) =>
              it === "-" ? <hr key={i} /> : it.file ? (
                <label key={i} className={it.danger ? "danger" : ""}>
                  {it.label}
                  <input type="file" accept={it.file} className="hidden" onChange={(e) => { setOpen(false); it.onChange(e); }} />
                </label>
              ) : (
                <button key={i} role="menuitem" className={it.danger ? "danger" : ""} onClick={() => { setOpen(false); it.onClick(); }}>{it.label}</button>
              )
            )}
          </div>
        )}
      </div>
    );
  }

  function Seg({ value, options, onChange }) {
    return (
      <div className="seg" role="tablist">
        {options.map(([v, label]) => (
          <button key={v} role="tab" aria-selected={value === v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>{label}</button>
        ))}
      </div>
    );
  }

  function GradeClassSelect({ grade, klass, onChange, classes, disabled }) {
    const max = Math.max(MAX_CLASS, ...(classes || []).map((c) => c.klass));
    return (
      <div className="grid grid-cols-2 gap-2">
        <select className="inp" value={grade || ""} disabled={disabled} onChange={(e) => onChange(toInt(e.target.value), klass)} aria-label="학년">
          <option value="">학년</option>
          {GRADES.map((g) => <option key={g} value={g}>{g}학년</option>)}
        </select>
        <select className="inp" value={klass || ""} disabled={disabled} onChange={(e) => onChange(grade, toInt(e.target.value))} aria-label="반">
          <option value="">반</option>
          {Array.from({ length: max }, (_, i) => i + 1).map((k) => <option key={k} value={k}>{k}반</option>)}
        </select>
      </div>
    );
  }

  window.GW = {
    db, auth, FieldValue, CONTACT, PATHS, AREAS, GRADES, PERIODS, MAX_CLASS,
    toInt, classKey, classLabel, rosterId, attendanceId, byGradeClassNo, todayKey, fmtDate, fmtPeriods, fmtTime,
    readTextFile, downloadCsv, commitInChunks, toast,
    useMedia, useWide, useCollection,
    Icon, Toast, Modal, Inspector, PageHead, Empty, Stat, MoreMenu, Seg, GradeClassSelect,
  };
})();
