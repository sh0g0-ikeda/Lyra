# GitHub main branch protection design

## 目的と範囲

GitHubの`main`へ、CI workflowの`verify`が成功していないcommitを統合できない
保護を設定する。既存の1人開発フローを維持するため、review approvalやcode owner
reviewは今回必須化しない。

対象はGitHub repository設定だけで、アプリケーション、DB、AWS、本番runtime、
ユーザーデータは変更しない。

## 根拠

- `docs/Lyra_Unified_Spec_v4.md` §10: release verification gate
- `docs/mobile-release-task-list-2026-07-30.md` GIT-120:
  mainのbranch protectionでCI `verify`をrequired status checkにする
- `AGENTS.md`: CIと検証を通したPRだけをmainへ統合する

## 設定

`main`のbranch protectionを次の値にする。

- required status check: `verify`
- strict: `true`
- enforce admins: `true`
- required pull request reviews: なし
- push restrictions: なし
- required linear history: `false`
- force push: 禁止
- branch deletion: 禁止
- branch lock: なし

`strict: true`により、PR headが最新mainへ追従してから`verify`を成功させる必要が
ある。`enforce_admins: true`により、repository管理者もrequired checkを迂回
できない。

## 既存運用への影響

- feature branchへのpush、draft PR、CI実行は従来どおり。
- `verify`がpendingまたはfailedのPRはmainへmergeできない。
- `verify`成功後は、review approvalなしで従来どおりsquash mergeできる。
- mainへ新しいcommitが入った場合、古いPRは最新mainを取り込んでCIを再実行する。
- direct pushもrequired checkを満たさないcommitでは保護される。

## セキュリティと可用性

- CIを迂回した未検証コードのmain反映を防ぐ。
- secret、token、workflow内容は変更しない。
- CI障害時はmain統合が停止するが、既存production runtimeは停止しない。
- 緊急時も保護を無言で解除せず、解除理由と時間を運用記録へ残す。

## 検証

1. 設定前のAPIが`Branch not protected`を返すことを確認する。
2. 設定後APIで`verify`、strict、admin enforcementをreadbackする。
3. PRの`verify`実行中にGitHubのmerge stateが`BLOCKED`になることを確認する。
4. 同じPRの`verify`成功後に`CLEAN`となり、SHA固定でmergeできることを確認する。
5. main統合後CIが成功し、annotationが0件であることを確認する。

## ロールバック

誤設定時は`main`のprotection APIからrequired check設定を戻す。ロールバックは
既存commitやbranch historyを変更せず、設定だけを戻す。CIサービス障害を理由に
一時解除する場合も、ユーザー承認と解除・復旧時刻を記録する。

## Sol / Terra

変更対象が単一のrepository設定と設計文書に限定され、利用可能な
`skills/lyra-sol-terra-orchestration`が現行mainに存在しないため、Sol単独で
設定、readback、PR検証を行う。
