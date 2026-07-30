# PR #67 / main divergence audit

## 目的と範囲

PR #67 (`feature/mobile-completion`) が現在の `main` から取り込めていない変更を全件分類し、既存本番実装を失わずにMobile機能を分割統合する境界を固定する。

この監査はread-onlyのGit比較に基づくドキュメント変更であり、コード、DB、AWS、Apple / Google、EASは変更しない。

## 比較スナップショット

| 項目 | 値 |
|---|---|
| main | `09a14134f8bb29a0ea8a77f1a773d49007b6c3d4` |
| feature/mobile-completion | `4ca174fcef20ef9a7bc638a5d4b444214c1bf06c` |
| merge base | `40c6449dbc5427be0372b39d8b15ad325cc220c6` |
| graph上の差分 | main-only 45 / feature-only 43 |
| patch等価を除く差分 | main-only 44 / feature-only 42 |

確認コマンド:

```text
git rev-list --left-right --count origin/main...origin/feature/mobile-completion
git log --left-only --cherry-pick --oneline origin/main...origin/feature/mobile-completion
git diff --name-status origin/feature/mobile-completion...origin/main
```

`3a4fdfa fix(story-ai): constrain beat plan output budget`はfeature側にpatch等価変更があるため、graph上ではmain-onlyだが`--cherry-pick`比較から除外される。

## 結論

PR #67をmergeまたは一括rebaseしない。featureブランチは実装候補の参照元としてだけ扱い、各機能を最新mainから作った新規ブランチへ必要最小限で移植する。

理由:

- mainには本番Story AIの上限対策、Web UI修正、CI保護、全業務JSON response contractが追加済み。
- PR #67側の`src/app.ts`、routes、services、shared contract、Web、CIはmainの新しい実装と競合する。
- feature側の古いファイル単位採用は、文字数上限対策、focus修正、strict response validation、branch protection証跡を失わせ得る。
- Mobile migration 027–036とMobile appは依然として分割移植が必要であり、main側変更を取り込む理由にはならない。

## main-only patch 44件と影響領域

### Story AI / page generation safety

| commits | 主な影響 |
|---|---|
| `e2f1506` (merge provenance), `3ff8f0f`, `70bffae` (merge provenance) | `src/domain/constants/generation.ts`, `src/domain/constants/storyAi.ts`, episode plan packing、OpenAI compiler、PageServiceと関連テスト。長大なbeat planを分割し、provider出力上限と連続性を守る |

補足: patch等価の`3a4fdfa`もgraph差分には含まれる。feature側に同等変更があるため再移植しない。

### Web UI / responsive / hierarchy focus

| commits | 主な影響 |
|---|---|
| `dff4ad1`, `855d93e`, `a9bab97` (merge provenance) | page AI actionの配置、generation readiness、Web E2E |
| `1e5f128`, `937adc6` (merge provenance) | smartphone Webの作品一覧、保存、新規キャラ、workspace導線、guide記載、App/CSS/E2E |
| `a650649`, `c301eef` (merge provenance), `96cdaf2` | hierarchy menuのfocus保持・Escape/trigger閉鎖とCI安定化 |

高衝突pathは`apps/web/src/App.tsx`、`apps/web/src/index.css`、`apps/web/src/components/StoryHierarchyTree.tsx`、`apps/web/e2e/app.spec.ts`。feature側の同名ファイルで上書きしない。

### CI / release governance / task evidence

| commits | 主な影響 |
|---|---|
| `3702cc6` | `.github/workflows/ci.yml`のGitHub Actions Node 24対応 |
| `1611091` | required `verify`、strict branch protection、admin enforcementの証跡 |
| `1da5006`, `1d792da`, `6e68a18`, `7680e40`, `d152183`, `1f1418a`, `0305141`, `edae88f`, `033b061` | Mobile残タスク、PR #67監査、分割統合順序、false-positive error、動的乖離の証跡 |

feature側の古いCI workflowとtask文書は採用せず、現在のmainを正とする。

### Shared response contract foundation

| commits | 主な影響 |
|---|---|
| `8c814ae` | payload値を漏らさない共通fail-closed guard |
| `b1b3720` | `/api/me` session contract、Docker production copy |
| `8aea746` | composition contractとS3 key非公開 |

### Billing / balloon / panel contracts

| commits | 主な影響 |
|---|---|
| `b87e1ab` | personal balanceとStripe subscription summary |
| `f2913b2` | balloon 7 typeとWeb wire |
| `2e4612e` | panel entity assignment |
| `4a1d9bc` | panel frame |
| `f366f9b` | panel |

### Scene / story / entity contracts

| commits | 主な影響 |
|---|---|
| `2690155` | Scene / Entity state作成更新 |
| `aa53cb4` | Entity state一覧、personal/org tenancy、Repository/Service/Route |
| `d5a6e6d` | Work / Chapter / Episode 12応答 |
| `89c2e5d` | Story AI改善、page skeleton、SSE |
| `207d217` | Entity CRUD |
| `0fc4985` | Entity reference/import/generation |

### Page / job / organization / remaining billing contracts

| commits | 主な影響 |
|---|---|
| `6f8f184` | Page一覧・設定 |
| `bd71a7a` | Page job受付・layout・Story autofill |
| `f065f35` | 4 generation job type |
| `2412cc3` | Organization workspace/member/invitation |
| `396b3b8` | Organization balance/billing/invoice |
| `366fb61` | Organization usage/audit |
| `5f63aa8` | Personal checkout/credit/portal |
| `09a1413` | Admin organization contract/credit grant |

これらは`packages/api-contract/src/mobileApiSchemas.ts`、各Route、contract/Routeテストを一体で更新している。PR #67の古いshared schemaをコピーせず、Mobile側生成物は現在のmain canonical contractから生成する。

## 分割統合時の判定

| feature側変更 | 扱い |
|---|---|
| mainに同等または新しい実装がある | 破棄し、mainを維持 |
| Mobile app、Mobile固有UI、native adapter | 最新mainから新規PRへ限定移植 |
| migration 027–036 | 番号・invariant・rollbackを再監査し、migration単位で移植 |
| Backend Route/Service/Repository | mainの認証・tenancy・response contractを基準に再実装 |
| `.github/workflows/ci.yml` | mainのrequired `verify`を維持し、Mobile jobだけを追加 |
| `apps/web` | mainを維持。Mobile機能に不可欠な共有変更だけ別PRで再設計 |
| generated Mobile schema/type/payload | main canonical contractからgeneratorで再生成 |

## 完了条件と次工程

- main-onlyのgraph 45件、patch-distinct 44件を分類した。
- 上書き禁止の高衝突pathと、再実装対象を明記した。
- PR #67の一括merge/rebaseを禁止し、最新main起点の分割PRを統合方針とした。
- 次工程はBackend migration 027以降を1単位ずつ監査し、その後Mobile基盤とcontract generator/inventoryを同時統合する。

