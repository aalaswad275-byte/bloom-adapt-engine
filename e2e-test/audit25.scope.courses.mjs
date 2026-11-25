import { act, ADMIN_EMAIL, ADMIN_PASSWORD, URL } from './lib.mjs'

const sign = await act('auth:signIn', {
  provider: 'password',
  params: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, flow: 'signIn' },
})
const token = sign?.tokens?.token

async function rawCall(kind, path, args) {
  const res = await fetch(`${URL}/api/${kind}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ path, args, format: 'json' }),
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text); }
  catch (e) { return { status: res.status, text: text.slice(0, 500) } }
  if (json.status === 'error') {
    return { status: res.status, error: json.errorMessage?.slice(0, 500) ?? text }
  }
  return { status: res.status, value: json.value }
}

const result = await rawCall('mutation', 'adminCourses:listCourses', {})
  .then(() => rawCall('query', 'adminCourses:listCourseModules', {}))
  .then(() => rawCall('query', 'adminCourses:listQuestions', {}))
  .then(() => rawCall('query', 'adminCourses:listExams', {}))
// fallback to adminAnalytics when a path is not public
const dash = await rawCall('query', 'adminAnalytics:getAdminDashboard', {})
console.log(JSON.stringify({ result, dash: dash.value?.counts ?? null }, null, 2))
