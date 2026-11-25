import { act, q } from './lib.mjs'
async function main() {
  const m = await act('auth:signIn', { provider: 'password', params: { email: 'admin@epc.ly', password: 'Assessment123!@#', flow: 'signIn' } })
  const t = m?.tokens?.token; console.log(t?.length ?? 0)
  const r = await q('adminCourses:listCourseModules', { courseId: ''), t)
  console.log(typeof r, r?.length)
}
