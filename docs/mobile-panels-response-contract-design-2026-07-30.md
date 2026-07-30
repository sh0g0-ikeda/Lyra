# Mobile panels response contract design

## 目的と範囲

PR #67 の Mobile API response contract から、Panelの作成、一覧、並べ替え、更新の成功応答を独立して共通Zod schemaへ接続する。

対象 endpoint:

- `POST /api/pages/:id/panels`
- `GET /api/pages/:id/panels`
- `PUT /api/pages/:id/panels/order`
- `PUT /api/panels/:id`

`DELETE /api/panels/:id`はbodyのない204のため対象外とする。JSON wire payload、HTTP status、DB、Service、監査ログ、認証・認可、入力検証は変更しない。Backend内部が契約外の値を返した場合だけ、壊れた成功応答を返さず既存の`CONFIGURATION_ERROR`とする。

## Spec 根拠

- `docs/Lyra_Unified_Spec_v4.md` §3: Routeのレスポンス変換責務
- `docs/Lyra_Unified_Spec_v4.md` §4: personal ownership / organization membership
- `docs/Lyra_Unified_Spec_v4.md` §8: 出力のschema validation
- `docs/Lyra_Unified_Spec_v4.md` §10: release verification gate
- `docs/mobile-release-task-list-2026-07-30.md` GIT-110 PR-A

## 現行契約と互換性の監査

現行Domain、Repository mapping、request validator、Webの`PanelRecord`、PR #67案を比較した。

- Panel role 7種、size 5種、正のorderは一致する
- entitiesは統合済みの`panelEntityAssignmentSchema`と一致する
- dialogue type 6種とposition 5種、nullable speakerは一致する
- composition sourceは3種で一致する
- nullable textとtimestamp fieldは一致する
- 一覧と並べ替えは`{ panels: [...] }`、作成と更新は単一Panelを返す

compositionの`shot_type`と`angle`はDomainではenumだが、Webのwire型とPR #67 response schemaは文字列またはnullである。Repositoryは未知値をnullへ正規化するが、response schemaでは既存wireを狭めず文字列またはnullを維持する。request側の最大長やdialogue speaker相関もresponseへ新しく遡及適用しない。

## 影響レイヤーとインターフェース

- Route: 4つの成功payloadの返却直前に共通schema検証を追加する
- Shared contract: dialogue item、Panel item、Panel一覧wrapperを追加する
- Tests: schemaの正常・入れ子異常と4 endpointのfail-closedを追加する
- Service / Repository / Domain / Infrastructure / Worker / Web / Mobile / Ops / Migration: 変更しない
- 永続化、外部API、ジョブ、クレジット: 変更しない

## セキュリティ

既存のJWT、rate limit、UUID validation、personal ownership、organizationの`view_work` / `edit_work` capability、organization auditを維持する。schema issue、Panel内容、秘密情報はerror messageやログへ追加しない。

## 必要十分条件

1. 現行Panel itemと`{ panels }`を受理する。
2. 統合済みassignment schemaを再利用し、重複定義を作らない。
3. enum外のPanel role、入れ子のassignment/dialogue異常、非正order、欠落fieldを拒否する。
4. 作成・一覧・並べ替え・更新が同じPanel item schemaを使う。
5. 正常時のfield、値、status、監査ログ順序を変えない。
6. 契約違反時は既存の`CONFIGURATION_ERROR`だけを返す。

## テスト方針

先に共通schemaと4 endpointの失敗テストを追加し、schema未実装・Route未接続で失敗することを確認する。その後、focused Vitest、全Vitest / Bun、migration / invariant、Backend build、Web lint / build、Playwright smokeを実行する。

## Sol / Terra

指定された`skills/lyra-sol-terra-orchestration`は現行mainに存在せず、sub-agent委譲の明示指示もない。変更は単一resourceのRoute、共通schema、限定テストに閉じるため、ここに設計・境界・検証方針を残し、Sol単独で実装とレビューを行う。
