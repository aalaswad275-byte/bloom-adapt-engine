import { act, q } from './lib.mjs'

async function main() {
  const res = await act('auth:signIn', { provider: 'password', params: { email: 'admin@epc.ly', password: 'Assessment123!@#', flow: 'signIn' } })
  const t = res?.tokens?.token
  console.log('token len', t?.length ?? 0)

  const raw = await fetch('https://dependable-goldfish-963.convex.cloud/api/query/adminCourses:listCourses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
    body: JSON.stringify({ path: 'adminCourses:listCourses', args: {}, format: 'json' }),
  })

  console.log('status', raw.status, 'ok', raw.ok)
  const txt = await raw.text()
  console.log('body', txt.slice(0, 400))
}
main().catch((e) => { console.error(e); process.exit(1) })
