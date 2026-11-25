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

const rows = await rawCall('query', 'adminCourses:listCourseModules', { courseId: 'n7...' })
console.log(JSON.stringify({ rows, courseId: 'n7...' }))
