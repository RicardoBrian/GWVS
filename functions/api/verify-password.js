// Cloudflare Pages Function: 교사 접속 비밀번호를 서버 측에서 검증한다.
// 실제 비밀번호는 Cloudflare 대시보드의 Secret(TEACHER_PASSWORD)에만 저장되며
// 클라이언트로는 성공/실패 여부만 전달된다.
export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return Response.json({ ok: false }, { status: 400 });
  }

  const { password } = body || {};
  const expected = env.TEACHER_PASSWORD;

  if (typeof password !== "string" || !expected) {
    return Response.json({ ok: false }, { status: 400 });
  }

  const ok = password === expected;
  return Response.json({ ok });
}
