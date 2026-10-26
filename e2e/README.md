# Browser tests (Playwright)

These drive real browsers through the parent portal and the SIS together, to
prove the two features the SIS serves to parents work end to end: the **report
card** and **absence & travel declarations**. They are not part of `npm test`.

## Local (`npm run e2e:parent`)

Runs against the local stack (docs/context/24-local-dev.md), so it may file,
approve and turn down declarations freely.

1. The local stack is running and `.env.development.local` points at it.
2. The SIS: `npm run dev` (port 3000).
3. The portal, from `../app-online-admission` on its `staging` branch, aimed at
   the local stack (it always calls the SIS at localhost:3000 in dev):

   ```
   VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=<ANON_KEY from `npx supabase status`> npx vite --port 5173
   ```

4. `npm run e2e:parent`

What it checks, as one story on a seeded family it finds itself:

- the parent opens the published report card (letterhead, the child, the
  adviser's comment);
- an absence without a certificate is filed, approved by the form class adviser
  then the officer in charge, and the class register is marked `EX` / `mc`;
  filing the same day again is refused;
- a travel declaration is approved and marked `EX` / `vacation`;
- an absence with an uploaded certificate is turned down with a reason, and the
  parent reads that reason; nothing is marked.

It clears its own filings (parent note starts `[e2e]`) before each run and puts
the publication window back afterwards. Screenshots land in `e2e/.results/`.

## Production (`npm run e2e:parent:prod`)

The staging portal already calls the **production** SIS and database, so this
acts as a real parent. Read-only unless told otherwise:

```
E2E_PARENT_EMAIL=… E2E_PARENT_PASSWORD=… npm run e2e:parent:prod
```

- `E2E_PORTAL_URL`: defaults to the staging portal; set it to the production
  portal once the features are on its `main`.
- `E2E_PROD_FILE=1` with `E2E_ADVISER_EMAIL` / `E2E_ADVISER_PASSWORD` also files
  one absence (note "Automated test by the SIS team, please ignore") and has the
  adviser **turn it down**, so no register is ever marked. The turned-down
  filing stays in both lists as a record.
