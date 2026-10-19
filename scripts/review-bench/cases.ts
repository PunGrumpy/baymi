/* oxlint-disable eslint/no-template-curly-in-string -- the strings are source code quoted into diffs */
/**
 * Diffs with one planted flaw each, and clean diffs that look like them.
 *
 * @remarks
 * A planted case scores a hit when a finding of medium or higher names
 * `path` and its title or body matches `flaw`. A clean case scores a false
 * positive on any finding of medium or higher.
 */

export type BenchCase =
  | {
      readonly diff: string;
      readonly flaw: RegExp;
      readonly kind: "planted";
      readonly name: string;
      readonly path: string;
    }
  | { readonly diff: string; readonly kind: "clean"; readonly name: string };

const diff = (path: string, header: string, lines: readonly string[]) =>
  [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    header,
    ...lines,
  ].join("\n");

export const CASES: readonly BenchCase[] = [
  {
    diff: diff(
      "src/routes/users.ts",
      "@@ -20,6 +20,12 @@ export const users = new Hono()",
      [
        " users.get('/', requireUser, listUsers)",
        "+",
        "+users.get('/search', requireUser, async (c) => {",
        "+  const name = c.req.query('name') ?? ''",
        "+  const rows = await sql.unsafe(`SELECT id, name FROM users WHERE name LIKE '%${name}%'`)",
        "+  return c.json(rows)",
        "+})",
      ]
    ),
    flaw: /sql|injection/iu,
    kind: "planted",
    name: "sql-injection",
    path: "src/routes/users.ts",
  },
  {
    diff: diff(
      "src/routes/admin.ts",
      "@@ -10,6 +10,10 @@ router.get('/admin/users', requireAdmin, listUsers)",
      [
        " router.get('/admin/users', requireAdmin, listUsers)",
        "+router.post('/admin/users/:id/role', async (req, res) => {",
        "+  await db.users.update({ where: { id: req.params.id }, data: { role: req.body.role } })",
        "+  res.sendStatus(204)",
        "+})",
      ]
    ),
    flaw: /auth|admin|role|privilege/iu,
    kind: "planted",
    name: "missing-authorization",
    path: "src/routes/admin.ts",
  },
  {
    diff: diff(
      "src/routes/invoices.ts",
      "@@ -4,6 +4,13 @@ import { requireUser } from '../auth'",
      [
        " export const invoices = Router()",
        "+",
        "+invoices.get('/:id', requireUser, async (req, res) => {",
        "+  const invoice = await db.invoice.findUnique({ where: { id: req.params.id } })",
        "+  if (!invoice) return res.sendStatus(404)",
        "+  res.json(invoice)",
        "+})",
      ]
    ),
    flaw: /owner|idor|other user|another user|any user|belong|authoriz/iu,
    kind: "planted",
    name: "idor",
    path: "src/routes/invoices.ts",
  },
  {
    diff: diff("src/routes/files.ts", "@@ -1,8 +1,14 @@", [
      " import path from 'node:path'",
      " import { Router } from 'express'",
      "+",
      "+const UPLOAD_DIR = '/srv/app/uploads'",
      "+",
      "+export const files = Router()",
      "+files.get('/download', (req, res) => {",
      "+  res.sendFile(path.join(UPLOAD_DIR, String(req.query.name)))",
      "+})",
    ]),
    flaw: /path|travers|\.\.\//iu,
    kind: "planted",
    name: "path-traversal",
    path: "src/routes/files.ts",
  },
  {
    diff: diff(
      "src/routes/preview.ts",
      "@@ -3,6 +3,13 @@ import { app } from '../app'",
      [
        " app.use(express.json())",
        "+",
        "+app.post('/api/link-preview', requireUser, async (req, res) => {",
        "+  const response = await fetch(req.body.url)",
        "+  const html = await response.text()",
        "+  res.json({ title: readTitle(html), status: response.status })",
        "+})",
      ]
    ),
    flaw: /ssrf|server-side request|internal|metadata|169\.254/iu,
    kind: "planted",
    name: "ssrf",
    path: "src/routes/preview.ts",
  },
  {
    diff: diff("src/deploy.ts", "@@ -1,5 +1,11 @@", [
      " import { execSync } from 'node:child_process'",
      "+",
      "+export const handleDeployHook = (payload: { ref: string }) => {",
      "+  const branch = payload.ref.replace('refs/heads/', '')",
      "+  execSync(`git fetch origin && git checkout ${branch} && bun run build`)",
      "+  return { deployed: branch }",
      "+}",
    ]),
    flaw: /command|shell|inject/iu,
    kind: "planted",
    name: "command-injection",
    path: "src/deploy.ts",
  },
  {
    diff: diff(
      "src/middleware/auth.ts",
      "@@ -8,9 +8,9 @@ export const requireUser: RequestHandler = (req, res, next) => {",
      [
        "   const token = req.headers.authorization?.replace('Bearer ', '')",
        "   if (!token) return res.sendStatus(401)",
        "-  const claims = jwt.verify(token, env.JWT_SECRET) as Claims",
        "+  const claims = jwt.decode(token) as Claims",
        "   req.user = { id: claims.sub, role: claims.role }",
        "   next()",
        " }",
      ]
    ),
    flaw: /signature|verif|forge|decode/iu,
    kind: "planted",
    name: "jwt-not-verified",
    path: "src/middleware/auth.ts",
  },
  {
    diff: diff(
      "src/routes/profile.ts",
      "@@ -12,6 +12,11 @@ profile.get('/', requireUser, getProfile)",
      [
        " profile.get('/', requireUser, getProfile)",
        "+",
        "+profile.patch('/', requireUser, async (req, res) => {",
        "+  const user = await db.user.update({ where: { id: req.user.id }, data: req.body })",
        "+  res.json(user)",
        "+})",
      ]
    ),
    flaw: /mass assign|role|admin|privilege|any field|req\.body/iu,
    kind: "planted",
    name: "mass-assignment",
    path: "src/routes/profile.ts",
  },
  {
    diff: diff(
      "src/components/Comment.tsx",
      "@@ -5,8 +5,8 @@ export const Comment = ({ comment }: { comment: CommentRow }) => (",
      [
        '   <article className="comment">',
        "     <header>{comment.author}</header>",
        "-    <p>{comment.body}</p>",
        "+    <p dangerouslySetInnerHTML={{ __html: renderMarkdown(comment.body) }} />",
        "   </article>",
        " )",
      ]
    ),
    flaw: /xss|script|html|sanitiz/iu,
    kind: "planted",
    name: "stored-xss",
    path: "src/components/Comment.tsx",
  },
  {
    diff: diff("src/auth/reset.ts", "@@ -1,6 +1,12 @@", [
      " import { db } from '../db'",
      "+",
      "+export const createResetToken = async (userId: string) => {",
      "+  const token = Math.random().toString(36).slice(2, 10)",
      "+  await db.passwordReset.create({ data: { token, userId, expiresAt: addHours(new Date(), 24) } })",
      "+  return token",
      "+}",
    ]),
    flaw: /random|predict|guess|entropy|crypto/iu,
    kind: "planted",
    name: "weak-reset-token",
    path: "src/auth/reset.ts",
  },
  {
    diff: diff(
      "src/routes/login.ts",
      "@@ -30,6 +30,8 @@ login.post('/', async (req, res) => {",
      [
        "   const session = await createSession(user.id)",
        "   res.cookie('sid', session.id, { httpOnly: true, secure: true, sameSite: 'lax' })",
        "-  res.redirect('/')",
        "+  const next = String(req.query.next ?? '/')",
        "+  res.redirect(next)",
        " })",
      ]
    ),
    flaw: /redirect|phish/iu,
    kind: "planted",
    name: "open-redirect",
    path: "src/routes/login.ts",
  },
  {
    diff: diff(".github/workflows/preview.yml", "@@ -1,6 +1,16 @@", [
      " name: preview",
      "-on: pull_request",
      "+on: pull_request_target",
      "+permissions:",
      "+  contents: write",
      "+  pull-requests: write",
      " jobs:",
      "   build:",
      "     runs-on: ubuntu-latest",
      "     steps:",
      "       - uses: actions/checkout@v5",
      "+        with:",
      "+          ref: ${{ github.event.pull_request.head.sha }}",
      "       - run: bun install && bun run build",
    ]),
    flaw: /pull_request_target|fork|untrusted|token|write/iu,
    kind: "planted",
    name: "workflow-pwn-request",
    path: ".github/workflows/preview.yml",
  },
  {
    diff: diff(
      "src/routes/users.ts",
      "@@ -20,6 +20,12 @@ export const users = new Hono()",
      [
        " users.get('/', requireUser, listUsers)",
        "+",
        "+users.get('/search', requireUser, async (c) => {",
        "+  const name = c.req.query('name') ?? ''",
        "+  const rows = await sql`SELECT id, name FROM users WHERE name LIKE ${`%${name}%`}`",
        "+  return c.json(rows)",
        "+})",
      ]
    ),
    kind: "clean",
    name: "clean-parameterized-query",
  },
  {
    diff: diff(
      "src/routes/invoices.ts",
      "@@ -4,6 +4,15 @@ import { requireUser } from '../auth'",
      [
        " export const invoices = Router()",
        "+",
        "+invoices.get('/:id', requireUser, async (req, res) => {",
        "+  const invoice = await db.invoice.findFirst({",
        "+    where: { id: req.params.id, ownerId: req.user.id },",
        "+  })",
        "+  if (!invoice) return res.sendStatus(404)",
        "+  res.json(invoice)",
        "+})",
      ]
    ),
    kind: "clean",
    name: "clean-owned-record",
  },
  {
    diff: diff(
      "src/components/Comment.tsx",
      "@@ -5,8 +5,8 @@ export const Comment = ({ comment }: { comment: CommentRow }) => (",
      [
        '   <article className="comment">',
        "     <header>{comment.author}</header>",
        "-    <p>{comment.body}</p>",
        '+    <p className="comment-body">{comment.body.trim()}</p>',
        "   </article>",
        " )",
      ]
    ),
    kind: "clean",
    name: "clean-escaped-render",
  },
  {
    diff: diff("src/auth/reset.ts", "@@ -1,6 +1,13 @@", [
      " import { db } from '../db'",
      "+import { randomBytes } from 'node:crypto'",
      "+",
      "+export const createResetToken = async (userId: string) => {",
      "+  const token = randomBytes(32).toString('base64url')",
      "+  await db.passwordReset.create({ data: { tokenHash: sha256(token), userId, expiresAt: addMinutes(new Date(), 30) } })",
      "+  return token",
      "+}",
    ]),
    kind: "clean",
    name: "clean-reset-token",
  },
];
