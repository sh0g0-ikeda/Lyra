# Lyraで学ぶDocker入門

この資料は、Dockerを初めて触る人が、Lyraの実際の構成を題材にしてDockerの仕組みを理解するための教材です。

Docker公式の「Get Started」では、主に次を学ぶ構成になっています。

- コンテナとしてイメージをビルドして実行する
- Docker Hubなどを使ってイメージを共有する
- データベースを含む複数コンテナ構成を動かす
- Docker Composeでアプリケーションを実行する
- イメージ構築の基本とベストプラクティスを理解する

Lyraもこれと同じ考え方で動いています。ローカル開発ではPostgreSQLをDocker Composeで起動し、本番ではDockerイメージをECRにpushして、ECS/Fargate上でAPIとworkerを動かします。

---

## 1. まず結論: Dockerは何をしているのか

Dockerは、アプリを「どのPCでも同じように動く箱」に入れる仕組みです。

Lyraで言うと、次の問題を解決するためにDockerを使っています。

- 開発者のPCにPostgreSQLを直接インストールしなくてもDBを使える
- APIサーバーを本番と同じ実行環境に近い形で動かせる
- 本番AWSへ「このイメージを動かして」と渡せる
- APIとworkerを同じ成果物から起動できる
- 環境差による「自分のPCでは動いたのに本番で動かない」を減らせる

Dockerを理解するうえで最重要の用語は4つです。

| 用語 | 一言でいうと | Lyraでの例 |
|---|---|---|
| Dockerfile | イメージの作り方を書いたレシピ | `Dockerfile` |
| イメージ | アプリ実行に必要なファイル一式を固めたもの | `lyra-prod-api:latest` |
| コンテナ | イメージから起動した実行中の箱 | APIコンテナ、Postgresコンテナ |
| Docker Compose | 複数コンテナをまとめて起動する設定 | `docker-compose.yml` |

重要なのは、**Dockerfileは設計図、イメージは完成品、コンテナは実行中の実体**という関係です。

---

## 2. Dockerなしだと何が困るのか

Lyraは単純な静的サイトではありません。少なくとも次の要素があります。

- React/Viteのフロントエンド
- Hono/Bun/Node系のAPIサーバー
- PostgreSQLデータベース
- 画像生成やページ生成用のworker
- S3、SQS、Stripe、Cognito、OpenAIなどの外部サービス

Dockerなしでローカル開発しようとすると、開発者のPCに次を直接入れる必要があります。

- PostgreSQL
- Bun
- Node.js/npm
- 必要なライブラリ
- DBユーザー
- DB名
- DBポート
- 環境変数

このうちPostgreSQLは特に環境差が出やすいです。

例えば、AさんのPCではPostgreSQL 16、BさんのPCではPostgreSQL 14、CさんのPCではそもそもPostgreSQLが入っていない、という状態になります。すると「DB接続できない」「マイグレーションが通らない」「ポートが競合する」といった問題が起きます。

Lyraでは、ローカルDBをDocker Composeで起動します。

```powershell
bun run db:up
```

これは内部的には次を実行しています。

```powershell
docker compose up -d postgres
```

つまり、開発者はPostgreSQLを直接インストールせずに、Docker上のPostgreSQLを使えます。

---

## 3. Dockerの基本概念

### 3-1. コンテナとは

コンテナは、ホストPC上で隔離されて動くプロセスです。

普通のアプリ実行と違い、コンテナは次を自分用に持っています。

- ファイルシステム
- 環境変数
- 実行コマンド
- ネットワーク設定
- ポート設定

ただし、コンテナは仮想マシンとは違います。

| 比較 | 仮想マシン | コンテナ |
|---|---|---|
| OS | ゲストOSを丸ごと持つ | ホストOSのカーネルを使う |
| 起動 | 重い | 軽い |
| 単位 | OSごと仮想化 | プロセスを隔離 |
| 用途 | 完全なOS環境 | アプリ実行環境 |

Docker公式の説明でも、コンテナは「隔離されたプロセス」であり、イメージの実行インスタンスとして扱われます。

Lyraで言えば、PostgreSQLコンテナは「PostgreSQLだけを動かす隔離されたプロセス」です。

### 3-2. イメージとは

イメージは、コンテナを起動するための読み取り専用テンプレートです。

イメージには次が含まれます。

- OSに近い基本ファイル
- ランタイム
- アプリのコード
- 依存ライブラリ
- 起動コマンド
- デフォルト環境変数

例えばLyraの本番イメージには、最終的に次が入ります。

- Bun runtime
- `dist/` にビルドされたAPIコード
- `public/` にビルドされたWebフロント
- `migrations/`
- `certs/`
- 本番起動コマンド

### 3-3. Dockerfileとは

Dockerfileは、イメージを作るための手順書です。

Lyraの`Dockerfile`は、ざっくり言うと次をしています。

1. Bunでバックエンド依存をインストール
2. TypeScriptをビルド
3. Nodeでフロントエンドをビルド
4. 本番用の軽いBun環境に成果物だけをコピー
5. `bun dist/scripts/startProductionApi.js`でAPIを起動

### 3-4. コンテナとイメージの関係

よくある混乱は、イメージとコンテナの違いです。

正確には次です。

```text
Dockerfile
  ↓ docker build
イメージ
  ↓ docker run
コンテナ
```

たとえるなら:

- Dockerfile: レシピ
- イメージ: 完成した冷凍食品
- コンテナ: 電子レンジで温めて食べている状態

イメージは停止しません。コンテナが停止します。

---

## 4. Docker DesktopとDocker CLI

WindowsでDockerを使う場合、通常はDocker Desktopをインストールします。

Docker Desktopには次が含まれます。

- Docker Engine
- Docker CLI
- Docker Compose
- Docker Desktop GUI
- WSL2連携

コマンド確認:

```powershell
docker --version
docker compose version
```

正常なら、例えば次のような表示になります。

```text
Docker version 27.x.x, build ...
Docker Compose version v2.x.x
```

Docker Desktopが起動していないと、`docker`コマンドは失敗します。

よくあるエラー:

```text
Cannot connect to the Docker daemon
```

意味:

```text
Docker CLIはあるが、裏側のDocker Engineが動いていない。
Docker Desktopを起動する必要がある。
```

---

## 5. Docker公式チュートリアルの最小例

Docker公式のGet Startedでは、まず次のようなコマンドでチュートリアル用コンテナを起動します。

```powershell
docker run -d -p 80:80 docker/getting-started
```

このコマンドを分解すると次です。

```text
docker run
```

イメージからコンテナを作って起動します。

```text
-d
```

detached mode、つまりバックグラウンドで動かします。

```text
-p 80:80
```

ホストPCのポート80を、コンテナ内のポート80につなぎます。

```text
docker/getting-started
```

使うイメージ名です。

短く書くと次です。

```powershell
docker run -dp 80:80 docker/getting-started
```

LyraのAPIをDockerで起動する場合も、この考え方は同じです。

```powershell
docker run -p 3000:3000 lyra-api
```

これは「ホストPCの3000番ポートを、コンテナ内の3000番ポートにつなぐ」という意味です。

---

## 6. LyraのDocker構成全体

LyraにあるDocker関連ファイルは主に次です。

```text
Dockerfile
docker-compose.yml
.dockerignore
package.json
```

それぞれの役割:

| ファイル | 役割 |
|---|---|
| `Dockerfile` | 本番用API/workerイメージの作り方 |
| `docker-compose.yml` | ローカルPostgreSQLを起動する設定 |
| `.dockerignore` | Docker buildに含めないファイルを指定 |
| `package.json` | Docker関連コマンドの入口 |

現在のLyraでは、ローカル開発時にアプリ全体をDocker Composeで起動する構成ではありません。

現在のローカル開発は次の形です。

```text
PostgreSQL: Docker Composeで起動
API: ホストPC上で bun run dev
Web: ホストPC上で bun run web:dev
```

図にすると次です。

```text
ブラウザ
  ↓ http://127.0.0.1:5173
Vite dev server（PC上）
  ↓ API proxy
Lyra API（PC上 / bun run dev）
  ↓ DATABASE_URL
PostgreSQL（Dockerコンテナ）
```

本番では次の形です。

```text
ブラウザ
  ↓
CloudFront / ALB
  ↓
ECS Fargate APIコンテナ
  ↓
RDS PostgreSQL

SQS
  ↓
ECS Fargate Workerコンテナ
  ↓
OpenAI / S3 / RDS
```

---

## 7. `docker-compose.yml`を読む

Lyraの`docker-compose.yml`は現在こういう構成です。

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: lyra-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: lyra
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - lyra-postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d lyra"]
      interval: 5s
      timeout: 5s
      retries: 12

volumes:
  lyra-postgres-data:
```

初心者向けに1行ずつ説明します。

### 7-1. `services`

```yaml
services:
```

Composeで起動するコンテナの一覧です。

Lyraでは今のところ`postgres`だけです。

### 7-2. `postgres`

```yaml
  postgres:
```

サービス名です。

この名前を使って次のように起動できます。

```powershell
docker compose up -d postgres
```

### 7-3. `image`

```yaml
    image: postgres:16-alpine
```

使うDockerイメージです。

意味:

```text
PostgreSQL 16 の Alpine Linux版イメージを使う
```

`alpine`は軽量Linuxディストリビューションです。DB開発用途では軽くて扱いやすいです。

### 7-4. `container_name`

```yaml
    container_name: lyra-postgres
```

起動するコンテナの名前です。

確認コマンド:

```powershell
docker ps
```

表示例:

```text
CONTAINER ID   IMAGE                NAMES
abc123         postgres:16-alpine   lyra-postgres
```

### 7-5. `restart`

```yaml
    restart: unless-stopped
```

Docker DesktopやPCを再起動した後、明示的に停止されていなければ再起動します。

`unless-stopped`の意味:

- Docker Engine再起動時にコンテナも復旧する
- ただし、自分で`docker stop`した場合は勝手に戻さない

### 7-6. `environment`

```yaml
    environment:
      POSTGRES_DB: lyra
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
```

コンテナ内に渡す環境変数です。

PostgreSQL公式イメージは、初回起動時にこれらを見てDBを作ります。

意味:

| 変数 | 意味 |
|---|---|
| `POSTGRES_DB` | 初期作成するDB名 |
| `POSTGRES_USER` | DBユーザー |
| `POSTGRES_PASSWORD` | DBパスワード |

LyraのローカルDB接続URLはこれに対応しています。

```env
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/lyra
```

分解すると:

```text
postgres:// ユーザー名 : パスワード @ ホスト : ポート / DB名
postgres:// postgres : postgres @ 127.0.0.1 : 5432 / lyra
```

### 7-7. `ports`

```yaml
    ports:
      - "5432:5432"
```

ポートを公開します。

形式:

```text
"ホスト側ポート:コンテナ側ポート"
```

Lyraでは:

```text
PCの5432番 → Postgresコンテナの5432番
```

だからAPIは次で接続できます。

```env
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/lyra
```

ここで`127.0.0.1`は自分のPCです。

### 7-8. `volumes`

```yaml
    volumes:
      - lyra-postgres-data:/var/lib/postgresql/data
```

DBデータを永続化する設定です。

コンテナは削除すると中のファイルも消えます。DBとしては困ります。そこでDocker volumeを使って、DBデータをコンテナ外に保存します。

意味:

```text
Docker volume lyra-postgres-data を
Postgresコンテナ内の /var/lib/postgresql/data に接続する
```

これにより、コンテナを作り直してもDBデータが残ります。

ただし、次を実行するとvolumeごと消えます。

```powershell
docker compose down -v
```

Lyraの`db:reset`はこれを使っています。

```json
"db:reset": "docker compose down -v && docker compose up -d postgres"
```

つまり`db:reset`はDBを完全初期化します。

### 7-9. `healthcheck`

```yaml
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d lyra"]
      interval: 5s
      timeout: 5s
      retries: 12
```

コンテナが本当に使える状態か確認する設定です。

`postgres`コンテナが起動していても、DBが接続可能になるまで数秒かかることがあります。`healthcheck`は`pg_isready`でDBが受け付け可能かを確認します。

確認コマンド:

```powershell
docker inspect lyra-postgres
```

または簡易的に:

```powershell
docker ps
```

`STATUS`に`healthy`が出ればOKです。

---

## 8. Lyraのローカル起動手順とDocker

### 8-1. Docker Desktopを起動する

Windowsでは、まずDocker Desktopを起動します。

確認:

```powershell
docker --version
docker compose version
```

### 8-2. PostgreSQLコンテナを起動する

Lyraのルートで実行します。

```powershell
cd C:\Users\shogo\Lyra
bun run db:up
```

内部的には:

```powershell
docker compose up -d postgres
```

### 8-3. コンテナ状態を確認する

```powershell
docker ps
```

見るべき点:

- `lyra-postgres`がある
- `postgres:16-alpine`を使っている
- `0.0.0.0:5432->5432/tcp`のような表示がある
- `healthy`になっている

### 8-4. ログを見る

```powershell
docker logs lyra-postgres
```

エラーがなければPostgreSQLが起動しています。

### 8-5. マイグレーションを実行する

```powershell
bun run migrate
```

マイグレーションとは、DBに必要なテーブルやカラムを作る処理です。

DockerはDBサーバーを起動しますが、Lyra用のテーブルまでは自動で作りません。Lyraのアプリ側が`migrations/`を読んでテーブルを作ります。

### 8-6. APIを起動する

```powershell
bun run dev
```

APIはDockerではなく、ホストPC上で起動します。

### 8-7. フロントエンドを起動する

別ターミナルで:

```powershell
bun run web:dev
```

ブラウザ:

```text
http://127.0.0.1:5173/
```

---

## 9. よく使うDockerコマンド

### 9-1. コンテナ一覧を見る

```powershell
docker ps
```

停止中も含める:

```powershell
docker ps -a
```

### 9-2. Composeで起動する

```powershell
docker compose up -d postgres
```

`-d`はバックグラウンド起動です。

### 9-3. Composeで停止する

```powershell
docker compose down
```

これはコンテナを停止・削除しますが、volumeは残ります。

### 9-4. DBデータも含めて完全削除する

```powershell
docker compose down -v
```

これは危険です。ローカルDBの中身が消えます。

Lyraでは次と同じ意味です。

```powershell
bun run db:reset
```

### 9-5. ログを見る

```powershell
docker logs lyra-postgres
```

リアルタイムで追う:

```powershell
docker logs -f lyra-postgres
```

### 9-6. コンテナの中に入る

```powershell
docker exec -it lyra-postgres sh
```

PostgreSQLコンテナ内でpsqlを使う:

```powershell
docker exec -it lyra-postgres psql -U postgres -d lyra
```

psqlから抜ける:

```sql
\q
```

### 9-7. イメージ一覧を見る

```powershell
docker images
```

### 9-8. volume一覧を見る

```powershell
docker volume ls
```

LyraのDB volumeを確認:

```powershell
docker volume ls | Select-String lyra
```

### 9-9. 使っていないリソースを掃除する

停止済みコンテナなどを掃除:

```powershell
docker system prune
```

volumeも含めて消す:

```powershell
docker system prune --volumes
```

注意:

```text
--volumesを付けるとDBデータが消える可能性があります。
LyraのローカルDBを残したい場合は使わないでください。
```

---

## 10. LyraのDockerfileを読む

Lyraの`Dockerfile`はマルチステージビルドです。

マルチステージビルドとは、ビルド用の環境と実行用の環境を分けることです。

理由:

- ビルドにはTypeScriptや開発依存が必要
- 本番実行にはビルド済みファイルだけでよい
- 最終イメージを小さくできる
- 不要なツールを本番に入れずに済む

LyraのDockerfileは4段階です。

```text
deps
  ↓
build
  ↓
web-build
  ↓
runtime
```

### 10-1. `deps`ステージ

```dockerfile
FROM oven/bun:1.3.11 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
```

意味:

```dockerfile
FROM oven/bun:1.3.11 AS deps
```

Bun入りの公式系イメージをベースにします。このステージ名を`deps`にします。

```dockerfile
WORKDIR /app
```

コンテナ内の作業ディレクトリを`/app`にします。

```dockerfile
COPY package.json bun.lock ./
```

依存関係の定義ファイルだけを先にコピーします。

```dockerfile
RUN bun install --frozen-lockfile
```

依存ライブラリをインストールします。

`--frozen-lockfile`の意味:

```text
bun.lockとpackage.jsonが食い違っていたら失敗する。
勝手にlockfileを書き換えない。
```

これは本番ビルドの再現性を守るために重要です。

### 10-2. `build`ステージ

```dockerfile
FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY worker ./worker
RUN bun run build
```

意味:

`deps`ステージでインストールした依存を使い、バックエンドのTypeScriptをビルドします。

`bun run build`は`package.json`では次です。

```json
"build": "tsc -p tsconfig.json"
```

つまりTypeScriptコンパイラで`dist/`を作ります。

### 10-3. `web-build`ステージ

```dockerfile
FROM node:24-slim AS web-build
WORKDIR /app/apps/web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web ./
ARG VITE_API_BASE_URL=
ARG VITE_COGNITO_DOMAIN=https://ap-northeast-1wizlzlgmm.auth.ap-northeast-1.amazoncognito.com
ARG VITE_COGNITO_CLIENT_ID=6b2h941o888u2l7ejhv5jog94
ARG VITE_COGNITO_REDIRECT_URI=https://app.lyra-editor.com/auth/callback
ARG VITE_COGNITO_LOGOUT_URI=https://app.lyra-editor.com
ARG VITE_COGNITO_SCOPES="openid email"
ARG VITE_COGNITO_API_TOKEN_USE=id
ENV LYRA_STRICT_WEB_PRODUCTION_CONFIG=true
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_COGNITO_DOMAIN=$VITE_COGNITO_DOMAIN
ENV VITE_COGNITO_CLIENT_ID=$VITE_COGNITO_CLIENT_ID
ENV VITE_COGNITO_REDIRECT_URI=$VITE_COGNITO_REDIRECT_URI
ENV VITE_COGNITO_LOGOUT_URI=$VITE_COGNITO_LOGOUT_URI
ENV VITE_COGNITO_SCOPES=$VITE_COGNITO_SCOPES
ENV VITE_COGNITO_API_TOKEN_USE=$VITE_COGNITO_API_TOKEN_USE
RUN npm run build
```

ここではReact/Viteフロントをビルドします。

ポイントは、フロントエンドの環境変数はビルド時に埋め込まれることです。

`VITE_`で始まる環境変数は、Viteのビルド時にフロントのJavaScriptへ反映されます。

つまり、次の値はコンテナ起動時ではなく、Docker build時に決まります。

- `VITE_COGNITO_DOMAIN`
- `VITE_COGNITO_CLIENT_ID`
- `VITE_COGNITO_REDIRECT_URI`
- `VITE_COGNITO_LOGOUT_URI`
- `VITE_COGNITO_SCOPES`
- `VITE_COGNITO_API_TOKEN_USE`

この性質は重要です。

例えばCognitoのリダイレクトURLを変えた場合、ECSの環境変数だけ変えてもフロントには反映されません。Dockerイメージを再ビルドして再デプロイする必要があります。

### 10-4. `runtime`ステージ

```dockerfile
FROM oven/bun:1.3.11-slim AS runtime
ENV NODE_ENV=production
ENV WEB_STATIC_DIR=./public
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY --from=build /app/dist ./dist
COPY --from=web-build /app/apps/web/dist ./public
COPY migrations ./migrations
COPY ops/certs ./certs
EXPOSE 3000
CMD ["bun", "dist/scripts/startProductionApi.js"]
```

ここが最終的な本番イメージです。

```dockerfile
FROM oven/bun:1.3.11-slim AS runtime
```

軽量版Bunイメージを使います。

```dockerfile
ENV NODE_ENV=production
ENV WEB_STATIC_DIR=./public
```

本番モードと、静的ファイルの場所を設定します。

```dockerfile
RUN bun install --frozen-lockfile --production
```

本番依存だけを入れます。

```dockerfile
COPY --from=build /app/dist ./dist
```

バックエンドのビルド成果物をコピーします。

```dockerfile
COPY --from=web-build /app/apps/web/dist ./public
```

フロントエンドのビルド成果物を`public/`にコピーします。

LyraのAPIは、この`public/`を配信します。つまり本番ではAPIコンテナがフロントの静的ファイルも返します。

```dockerfile
EXPOSE 3000
```

このコンテナは3000番ポートを使う、という宣言です。

注意:

```text
EXPOSEはポートを実際に公開する命令ではありません。
実際にホストへ公開するには docker run -p 3000:3000 が必要です。
ECSではタスク定義やロードバランサー側の設定が必要です。
```

```dockerfile
CMD ["bun", "dist/scripts/startProductionApi.js"]
```

デフォルトの起動コマンドです。

コンテナを普通に起動するとAPIが立ち上がります。

---

## 11. APIコンテナとworkerコンテナの違い

Lyra本番では、APIとworkerが同じDockerイメージから動きます。

違うのは起動コマンドです。

API:

```powershell
bun dist/scripts/startProductionApi.js
```

中身:

```ts
await loadRuntimeSecretEnv();
await import('../src/index.js');
```

worker:

```powershell
bun dist/scripts/startProductionWorker.js
```

中身:

```ts
await loadRuntimeSecretEnv();
await import('./runGenerationWorker.js');
```

つまり、同じイメージに次が入っています。

- API起動コード
- worker起動コード
- 共通サービス
- 共通DB接続
- 共通マイグレーション
- Web静的ファイル

ECS側で「APIサービスはAPIコマンド」「workerサービスはworkerコマンド」と分けています。

この設計のメリット:

- ビルド成果物が1種類で済む
- APIとworkerのコードバージョンがズレにくい
- ECR pushが簡単
- デプロイの管理が単純

デメリット:

- イメージサイズはやや大きくなりやすい
- workerだけに不要なWeb静的ファイルも入る
- APIだけに不要なworkerコードも入る

Lyraでは、運用の単純さを優先して同一イメージ方式を採用しています。

---

## 12. `.dockerignore`を読む

`.dockerignore`は、Docker build時に送らないファイルを指定します。

Lyraの`.dockerignore`には次のようなものがあります。

```text
.git
.github
.aws
.localdata
apps/web/node_modules
apps/web/dist
apps/web/.env
apps/web/test-results
node_modules
dist
coverage
*.log
.env
.env.*
cloud-architecture.png
risks.md
gen.md
docs/patent_disclosure.md
docs/security_risk.md
```

なぜ必要か。

Docker buildでは、まず「ビルドコンテキスト」という形でファイル一式をDockerに渡します。不要なファイルが多いと、ビルドが遅くなります。

また、`.env`や`.aws`をDocker buildに渡すと危険です。

理由:

- APIキーがイメージに混入する可能性がある
- ローカル設定が本番イメージに入る可能性がある
- ビルドログやレイヤーに機密情報が残る可能性がある

`.dockerignore`はセキュリティ上かなり重要です。

特にLyraでは次を除外している点が重要です。

```text
.env
.env.*
.aws
apps/web/.env
```

これは「シークレットはイメージに焼き込まない」という原則です。

---

## 13. 環境変数とDocker

Dockerでは、同じイメージを使っても、環境変数を変えることで動作を変えられます。

Lyraの重要な環境変数:

| 変数 | 役割 |
|---|---|
| `APP_ENV` | development/test/production |
| `NODE_ENV` | Node/Bunの実行モード |
| `PORT` | APIの待受ポート |
| `DATABASE_URL` | PostgreSQL接続先 |
| `DATABASE_SSL_MODE` | DB SSL設定 |
| `AUTH_PROVIDER` | supabase/cognito |
| `GENERATION_ENABLED` | 画像生成全体の有効/無効 |
| `PAGE_GENERATION_ENABLED` | ページ生成の有効/無効 |
| `ENTITY_GENERATION_ENABLED` | キャラ生成の有効/無効 |
| `SQS_QUEUE_URL_GENERATION` | 生成ジョブ用SQS |
| `S3_BUCKET_IMAGES` | 画像保存先S3 |
| `OPENAI_API_KEY` | OpenAI APIキー |
| `STRIPE_SECRET_KEY` | Stripe secret |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook検証 |

ローカルでは`.env`を使います。

本番ではAWS Secrets Managerから読み込みます。

本番起動スクリプト:

```ts
await loadRuntimeSecretEnv();
await import('../src/index.js');
```

この`loadRuntimeSecretEnv()`が、Secrets Managerから値を読み込んで`process.env`に反映します。

Dockerの原則:

```text
イメージには機密情報を入れない。
コンテナ起動時に環境変数またはSecrets Managerから渡す。
```

---

## 14. ローカルDBと本番DBの違い

ローカル:

```env
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/lyra
DATABASE_SSL_MODE=disable
```

本番:

```env
DATABASE_URL=postgres://lyra:...@lyra-prod-db....rds.amazonaws.com:5432/lyra
DATABASE_SSL_MODE=require
```

違い:

| 項目 | ローカル | 本番 |
|---|---|---|
| DB | Docker Postgres | AWS RDS |
| 接続先 | `127.0.0.1` | RDS endpoint |
| SSL | disable | require |
| 認証 | ローカル固定値 | Secrets Manager |
| データ | 開発用 | ユーザー本番データ |

Lyraの本番起動時には、ローカルDBを指していると起動に失敗する安全装置があります。

これは重要です。

もし本番APIが間違って`localhost`に接続しようとすると、ECSコンテナ内の自分自身を見に行くためDB接続できません。さらに、設定ミスを見逃すと障害になります。

そのためLyraは本番で次を拒否します。

- `localhost`
- `127.0.0.1`
- `::1`
- SSL無効
- placeholder値

---

## 15. Dockerネットワークの基礎

### 15-1. ホストとコンテナの違い

Dockerでは、ホストPCとコンテナは別のネットワーク空間にいます。

LyraのPostgres:

```yaml
ports:
  - "5432:5432"
```

これにより、ホストPCからは次で接続できます。

```text
127.0.0.1:5432
```

もしポート公開がなければ、ホストPC上のAPIから`127.0.0.1:5432`で接続できません。

### 15-2. Compose内部の名前解決

もしAPIもComposeで起動する場合、APIコンテナからPostgresへは通常こう接続します。

```env
DATABASE_URL=postgres://postgres:postgres@postgres:5432/lyra
```

ここでホスト名が`127.0.0.1`ではなく`postgres`になります。

理由:

```text
Compose内ではサービス名がDNS名になる。
```

現在のLyraローカル構成ではAPIはホストPC上で動くため、`127.0.0.1`を使います。

ここは初心者が混乱しやすい点です。

| APIの実行場所 | DBホスト名 |
|---|---|
| PC上で`bun run dev` | `127.0.0.1` |
| Docker Compose内のAPIコンテナ | `postgres` |
| 本番ECS | RDS endpoint |

---

## 16. Docker volumeとDB永続化

PostgreSQLのデータはコンテナ内の次に保存されます。

```text
/var/lib/postgresql/data
```

LyraではここにDocker volumeを接続しています。

```yaml
volumes:
  - lyra-postgres-data:/var/lib/postgresql/data
```

これにより:

- `docker compose down`してもDBデータは残る
- `docker compose up`すれば同じDBが戻る
- `docker compose down -v`するとDBデータも消える

確認:

```powershell
docker volume ls
```

詳細:

```powershell
docker volume inspect lyra_lyra-postgres-data
```

Composeのプロジェクト名によって、実際のvolume名は`lyra-postgres-data`ではなく`lyra_lyra-postgres-data`のようになることがあります。

---

## 17. LyraのDocker build

Lyraの本番イメージをローカルでビルドする基本コマンド:

```powershell
docker build -t lyra-api:local .
```

意味:

```text
Dockerfileを使って、現在ディレクトリ`.`をビルドコンテキストにし、
lyra-api:localという名前のイメージを作る
```

確認:

```powershell
docker images | Select-String lyra-api
```

### 17-1. BuildKit/buildx

本番デプロイでは、arm64向けにbuildxを使っています。

例:

```powershell
docker buildx build --platform linux/arm64 `
  -t 452284481392.dkr.ecr.ap-northeast-1.amazonaws.com/lyra-prod-api:some-tag `
  -t 452284481392.dkr.ecr.ap-northeast-1.amazonaws.com/lyra-prod-worker:some-tag `
  --push .
```

意味:

| 部分 | 意味 |
|---|---|
| `docker buildx build` | 高機能ビルダーでビルド |
| `--platform linux/arm64` | ARM64 Linux向けイメージを作る |
| `-t ...` | タグを付ける |
| `--push` | ビルド後にレジストリへpush |
| `.` | 現在ディレクトリをビルドコンテキストにする |

なぜ`linux/arm64`か。

ECS/FargateでARM64を使うと、x86_64より安くなることがあります。Lyraではコスト削減のためARM64を使っています。

---

## 18. イメージタグ

Dockerイメージにはタグを付けます。

例:

```text
lyra-prod-api:latest
lyra-prod-api:panel-lock-20260706-032a80f-arm64
```

タグはバージョン名です。

`latest`は便利ですが、本番運用では事故原因になりやすいです。

理由:

- `latest`がどのコードを指すか曖昧
- ロールバックしにくい
- ECSタスク定義と実イメージの対応が見えにくい

Lyraではコミットハッシュや日付を含むタグを使っています。

例:

```text
panel-lock-20260706-032a80f-arm64
```

このタグから次がわかります。

- 何の変更か: `panel-lock`
- いつ作ったか: `20260706`
- どのコミットか: `032a80f`
- どのCPU向けか: `arm64`

---

## 19. ECRとは

ECRはAWSのDockerイメージ置き場です。

正式名:

```text
Amazon Elastic Container Registry
```

Lyraでは次のリポジトリを使っています。

```text
452284481392.dkr.ecr.ap-northeast-1.amazonaws.com/lyra-prod-api
452284481392.dkr.ecr.ap-northeast-1.amazonaws.com/lyra-prod-worker
```

イメージをECRにpushすると、ECSがそのイメージをpullしてコンテナを起動できます。

流れ:

```text
ローカルPC
  ↓ docker build
Dockerイメージ
  ↓ docker push
ECR
  ↓ ECSがpull
ECS/Fargateコンテナ
```

---

## 20. ECS/FargateとDocker

ECSはAWSのコンテナ管理サービスです。

Fargateは、サーバー管理なしでコンテナを動かす実行方式です。

Lyraでは:

- APIコンテナをECSサービスとして常時動かす
- workerコンテナをSQSジョブ量に応じて動かす
- RDS、S3、SQS、Secrets Managerと連携する

ECSでDockerを動かすには、主に次が必要です。

| 要素 | 役割 |
|---|---|
| ECR | Dockerイメージ置き場 |
| ECS Cluster | コンテナ実行のまとまり |
| Task Definition | どのイメージをどう起動するか |
| ECS Service | タスクを何台維持するか |
| ALB | 外部HTTPアクセスをAPIへ流す |
| Security Group | 通信許可 |
| IAM Role | AWS API操作権限 |
| Secrets Manager | 機密設定 |

Docker単体では「コンテナを起動する」だけです。

ECSは「本番でコンテナを継続運用する」ための仕組みです。

---

## 21. Lyraの本番コンテナ起動

LyraのDockerfileのデフォルトCMDはAPIです。

```dockerfile
CMD ["bun", "dist/scripts/startProductionApi.js"]
```

APIコンテナは次をします。

1. Secrets Managerから環境変数を読む
2. 本番設定の安全チェックをする
3. 必要なら古い生成ジョブを復旧する
4. Hono APIを起動する
5. Web静的ファイルも配信する

workerコンテナは、ECSタスク定義のcommand overrideで別コマンドを使います。

```powershell
bun dist/scripts/startProductionWorker.js
```

workerは次をします。

1. Secrets Managerから環境変数を読む
2. SQSをlong pollingする
3. page/entity generationジョブを取得する
4. OpenAIやS3を使って生成処理する
5. 成功または恒久失敗ならSQSメッセージを削除する
6. 一時失敗なら削除せず、SQS retryに任せる

---

## 22. DockerとSQS workerの関係

Lyraの重い処理はAPIリクエスト内で直接完了させない設計です。

例えばページ画像生成:

```text
ユーザーがページ生成を押す
  ↓
APIがDBにジョブを作る
  ↓
APIがSQSにメッセージを送る
  ↓
workerコンテナがSQSから受け取る
  ↓
workerが画像生成する
  ↓
workerがDB/S3に結果を書く
  ↓
フロントがジョブ状態をポーリングする
```

この設計の理由:

- APIレスポンスを長時間ブロックしない
- 画像生成失敗時に再試行しやすい
- worker台数を増やして処理能力を上げられる
- 夜間はworkerを0台にしてコストを下げられる

Docker的には、APIとworkerはどちらもコンテナですが、役割が違います。

```text
APIコンテナ: HTTPを受ける
workerコンテナ: SQSを読む
```

---

## 23. DockerでLyra APIをローカル起動する場合

通常のローカル開発では`bun run dev`を使いますが、Docker学習用にAPIイメージを動かすこともできます。

ただし、Lyraの本番起動は本番設定チェックが厳しいため、単純な`docker run`では失敗しやすいです。

学習用に理解すべきポイント:

```text
Dockerfileの最終CMDはproduction API用。
ローカル開発用のAPI起動とは別物。
```

ローカルで本番イメージを動かすには、少なくとも次を意識します。

- `DATABASE_URL`
- `NODE_ENV`
- `APP_ENV`
- `AUTH_PROVIDER`
- `DEV_AUTH_BYPASS`
- `WEB_STATIC_DIR`
- generation系のkill switch

ただし、初心者がまず触るべきなのはDBコンテナです。

推奨学習順:

1. `docker compose up -d postgres`
2. `docker ps`
3. `docker logs`
4. `docker exec`
5. `docker compose down`
6. `docker build`
7. ECR/ECSの概念理解

---

## 24. Docker buildのキャッシュ

Docker buildはレイヤーごとにキャッシュします。

LyraのDockerfileでは、依存ファイルだけを先にコピーしています。

```dockerfile
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
```

その後にソースをコピーします。

```dockerfile
COPY src ./src
COPY scripts ./scripts
COPY worker ./worker
```

この順番には意味があります。

もし先にソース全体をコピーしてから`bun install`すると、コードを1行変えただけで依存インストールがやり直しになります。

今の順番なら:

- `package.json`や`bun.lock`が変わらない
- 依存インストールのレイヤーを再利用できる
- ビルドが速くなる

これはDockerfileの基本的なベストプラクティスです。

---

## 25. `npm ci`と`bun install --frozen-lockfile`

Lyraのフロントビルドでは:

```dockerfile
RUN npm ci
```

バックエンドでは:

```dockerfile
RUN bun install --frozen-lockfile
```

どちらも目的は同じです。

```text
lockfileに従って、再現性のある依存インストールをする
```

`npm install`はpackage-lockを更新する可能性があります。

本番ビルドでは、勝手に依存バージョンが変わると危険です。

そのため:

- npmなら`npm ci`
- Bunなら`bun install --frozen-lockfile`

を使います。

---

## 26. セキュリティ面でDockerを見る

### 26-1. シークレットをイメージに入れない

やってはいけない例:

```dockerfile
ENV OPENAI_API_KEY=sk-...
ENV STRIPE_SECRET_KEY=sk_live_...
```

これは絶対に避けます。

理由:

- イメージにAPIキーが焼き込まれる
- ECRに残る
- ローカルにpullした人が見られる
- Docker layer履歴に残る可能性がある

LyraではSecrets Managerから起動時に読み込む設計です。

### 26-2. `.dockerignore`で機密ファイルを除外する

Lyraでは次を除外しています。

```text
.env
.env.*
.aws
apps/web/.env
```

これにより、Docker build contextに秘密情報が入りにくくなります。

### 26-3. 本番ガード

Lyraは本番起動時に設定を検査します。

例:

- `DATABASE_URL`がlocalを向いていないか
- Stripe keyがlive keyか
- Stripe webhook secretが`whsec_`で始まるか
- Cognito設定があるか
- SQS visibility timeoutが短すぎないか
- 画像CDN URLがHTTPSか

Dockerイメージ自体は同じでも、環境変数が危険なら起動を止めます。

これは本番事故を防ぐために重要です。

---

## 27. Dockerとポート

Lyra APIはコンテナ内で3000番ポートを使います。

Dockerfile:

```dockerfile
EXPOSE 3000
```

ローカルで公開するなら:

```powershell
docker run -p 3000:3000 lyra-api:local
```

意味:

```text
PCの3000番 → コンテナの3000番
```

もし左側を変えると:

```powershell
docker run -p 8080:3000 lyra-api:local
```

意味:

```text
PCの8080番 → コンテナの3000番
```

アクセスURL:

```text
http://localhost:8080
```

右側はコンテナ内のポートなので、アプリが待ち受けているポートに合わせます。

左側はPC側のポートなので、空いている番号を使えます。

---

## 28. Docker Composeと単体docker runの違い

単体:

```powershell
docker run postgres:16-alpine
```

Compose:

```powershell
docker compose up -d postgres
```

違い:

| 項目 | docker run | Docker Compose |
|---|---|---|
| 向いている用途 | 1個のコンテナを試す | 複数サービスをまとめる |
| 設定 | コマンド引数に書く | YAMLに書く |
| 再現性 | 長いコマンドになりがち | ファイルで共有しやすい |
| Lyraでの用途 | 学習・一時実行 | ローカルPostgres |

LyraのPostgreSQLを`docker run`で書くと長くなります。

```powershell
docker run -d `
  --name lyra-postgres `
  -e POSTGRES_DB=lyra `
  -e POSTGRES_USER=postgres `
  -e POSTGRES_PASSWORD=postgres `
  -p 5432:5432 `
  -v lyra-postgres-data:/var/lib/postgresql/data `
  postgres:16-alpine
```

Composeなら短いです。

```powershell
docker compose up -d postgres
```

だから開発用DBにはComposeが向いています。

---

## 29. 初心者がLyraで試すべき演習

### 演習1: Postgresを起動する

```powershell
cd C:\Users\shogo\Lyra
bun run db:up
docker ps
```

確認:

- `lyra-postgres`がある
- `5432`が公開されている

### 演習2: DBに入る

```powershell
docker exec -it lyra-postgres psql -U postgres -d lyra
```

psql内:

```sql
\dt
```

テーブル一覧が出ます。

抜ける:

```sql
\q
```

### 演習3: ログを見る

```powershell
docker logs lyra-postgres
```

### 演習4: 停止して再起動する

```powershell
docker compose down
docker compose up -d postgres
```

DBデータが残っていることを確認します。

### 演習5: DBを完全初期化する

注意: ローカルDBが消えます。

```powershell
bun run db:reset
bun run migrate
```

これは次と同じです。

```powershell
docker compose down -v
docker compose up -d postgres
```

### 演習6: Dockerfileをビルドする

```powershell
docker build -t lyra-api:local .
```

確認:

```powershell
docker images | Select-String lyra-api
```

### 演習7: イメージサイズを見る

```powershell
docker images lyra-api
```

### 演習8: コンテナを削除する

停止:

```powershell
docker stop lyra-postgres
```

削除:

```powershell
docker rm lyra-postgres
```

Compose管理のコンテナは基本的にこちらで操作するのが安全です。

```powershell
docker compose down
```

---

## 30. トラブルシューティング

### 30-1. `docker`コマンドが見つからない

症状:

```text
docker : 用語 'docker' は、コマンドレット、関数...
```

原因:

- Docker Desktopがインストールされていない
- PATHが通っていない
- PowerShellを再起動していない

対応:

1. Docker Desktopをインストール
2. PCまたはPowerShellを再起動
3. `docker --version`を確認

### 30-2. Docker daemonに接続できない

症状:

```text
Cannot connect to the Docker daemon
```

原因:

- Docker Desktopが起動していない
- WSL2 backendが起動していない

対応:

1. Docker Desktopを起動
2. 数十秒待つ
3. `docker ps`を実行

### 30-3. 5432ポートが既に使われている

症状:

```text
Bind for 0.0.0.0:5432 failed: port is already allocated
```

原因:

- PCに直接PostgreSQLが入っている
- 別のコンテナが5432を使っている

確認:

```powershell
docker ps
```

Windowsでポート使用確認:

```powershell
netstat -ano | Select-String ":5432"
```

対処案:

1. 既存PostgreSQLを止める
2. 既存コンテナを止める
3. `docker-compose.yml`の左側ポートを変える

例:

```yaml
ports:
  - "15432:5432"
```

その場合、`.env`も変えます。

```env
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:15432/lyra
```

### 30-4. マイグレーションがDBに接続できない

確認:

```powershell
docker ps
docker logs lyra-postgres
```

`.env`の確認:

```env
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/lyra
```

Postgresがhealthyになる前に`bun run migrate`すると失敗することがあります。数秒待って再実行してください。

### 30-5. Docker buildが遅い

原因候補:

- 初回ビルド
- npm/bun依存のインストール
- Docker Desktopのリソース不足
- `.dockerignore`漏れ
- ネットワークが遅い

確認:

```powershell
docker build --progress=plain -t lyra-api:local .
```

### 30-6. DockerがPC全体を重くする

原因候補:

- Docker Desktopのメモリ使用量
- WSL2のメモリ使用量
- node_modulesやdistを含めた重いファイル監視
- ビルドキャッシュ肥大化
- 大量の未使用イメージ

確認:

```powershell
docker system df
```

掃除:

```powershell
docker system prune
```

DB volumeを消したくない場合は`--volumes`を付けないでください。

---

## 31. Lyraの本番デプロイとDockerの流れ

Lyraのデプロイは概念的には次です。

```text
1. コードを修正
2. テスト
3. Docker build
4. ECRへpush
5. ECS task definitionを更新
6. ECS serviceを更新
7. health check
```

### 31-1. build

```powershell
docker buildx build --platform linux/arm64 `
  -t 452284481392.dkr.ecr.ap-northeast-1.amazonaws.com/lyra-prod-api:TAG `
  -t 452284481392.dkr.ecr.ap-northeast-1.amazonaws.com/lyra-prod-worker:TAG `
  --push .
```

### 31-2. task definition

ECS task definitionには次が書かれます。

- 使うイメージ
- CPU
- メモリ
- ポート
- 環境変数
- Secrets Manager
- IAM role
- ログ設定
- 起動コマンド

APIとworkerの違いは主に起動コマンドです。

### 31-3. service update

API:

```text
lyra-prod-api serviceを新しいtask definitionへ更新
```

worker:

```text
lyra-prod-worker serviceを新しいtask definitionへ更新
```

### 31-4. health check

API:

```text
https://app.lyra-editor.com/healthz
```

200が返れば最低限APIは生きています。

---

## 32. DockerとCloudFront/ALBの関係

Dockerコンテナは直接ユーザーに公開されているわけではありません。

Lyra本番では概念的に次の経路です。

```text
ユーザーのブラウザ
  ↓
CloudFront
  ↓
ALB
  ↓
ECS Fargate APIコンテナ
```

コンテナはECS内部で動きます。

外部公開はALBやCloudFrontが担当します。

役割:

| 要素 | 役割 |
|---|---|
| Dockerコンテナ | アプリを実行 |
| ECS | コンテナを維持 |
| ALB | HTTPをコンテナへ振り分け |
| CloudFront | CDN、HTTPS、キャッシュ、エッジ配信 |
| Route 53/DNS | ドメインを向ける |

Dockerだけでは本番公開は完結しません。

Dockerは「アプリを箱に入れる」ところまでです。

AWS側が「その箱を安全に公開し、継続運用する」役割を持ちます。

---

## 33. Dockerとコスト

Docker自体はローカルでは無料で使えます。ただし、Docker Desktopの商用利用条件には注意が必要です。大企業での利用には有料契約が必要になる場合があります。

AWS本番ではDockerイメージを動かすために次のコストが発生します。

- ECS/FargateのCPU/メモリ
- ALB
- RDS
- NAT Gatewayを使う場合はNAT
- S3
- CloudWatch Logs
- ECR storage
- データ転送

Lyraでコストに効くDocker関連要素:

- API serviceの常時稼働台数
- worker serviceの最小台数
- workerを夜間0台にするか
- イメージサイズ
- CloudWatch Logsの量
- ECSのCPU/メモリサイズ

Dockerイメージが大きすぎると:

- pullが遅い
- 起動が遅い
- ECR storageが増える
- デプロイが遅くなる

ただし、Lyraの主なコストはDockerイメージサイズよりも、ECS/RDS/ALB/OpenAI/S3側です。

---

## 34. Dockerとセキュリティ運用

Lyraで意識すべきDockerセキュリティ:

### 34-1. イメージに秘密情報を入れない

`.env`、AWS認証情報、Stripe key、OpenAI keyをCOPYしない。

Lyraは`.dockerignore`で防いでいます。

### 34-2. production guardで起動時に落とす

危険な設定ならコンテナが起動しないようにします。

この方が「危険な状態で動く」より安全です。

### 34-3. IAM roleで権限を最小化する

ECS task roleには、必要なAWS APIだけ許可します。

APIとworkerで必要権限が違う場合、将来的にはroleを分ける余地があります。

### 34-4. base imageを更新する

`oven/bun:1.3.11`や`node:24-slim`などのベースイメージには脆弱性が見つかることがあります。

定期的に更新し、テストしてからデプロイします。

### 34-5. root実行の検討

現在のDockerfileでは明示的な非rootユーザー指定はありません。

より厳格にするなら、runtime stageで非rootユーザーを作り、`USER`指定する余地があります。

ただし、ファイル権限やBun実行、証明書読み込み、静的ファイル配信に影響するため、変更時は検証が必要です。

---

## 35. 初心者向け: Docker学習で混乱しやすい点

### 35-1. `localhost`の意味は実行場所で変わる

PC上のAPIから見た`localhost`:

```text
自分のPC
```

コンテナ内のAPIから見た`localhost`:

```text
そのAPIコンテナ自身
```

だから、APIをコンテナ化した場合、DB接続先は`127.0.0.1`ではなく`postgres`やRDS endpointになります。

### 35-2. `EXPOSE`だけではポート公開されない

Dockerfile:

```dockerfile
EXPOSE 3000
```

これは「このコンテナは3000を使う」というメタ情報です。

実際の公開には:

```powershell
docker run -p 3000:3000 ...
```

が必要です。

### 35-3. コンテナを消してもvolumeは残る

```powershell
docker compose down
```

ではDBデータは残ります。

```powershell
docker compose down -v
```

ではDBデータも消えます。

### 35-4. イメージを更新しても既存コンテナは勝手に変わらない

イメージを再ビルドしても、起動済みコンテナは古いままです。

再作成が必要です。

Composeなら:

```powershell
docker compose up -d --build
```

ECSなら:

```text
新しいtask definitionを作り、serviceを更新する
```

### 35-5. フロントのVITE環境変数はビルド時に決まる

LyraではCognitoなどのフロント設定はDocker build時に埋め込まれます。

起動時に環境変数だけ変えても、ブラウザ側JavaScriptには反映されません。

---

## 36. Lyraを題材にしたDocker理解チェック

### Q1. `bun run db:up`は何をしているか

答え:

```text
docker compose up -d postgres を実行し、
docker-compose.ymlに定義されたPostgreSQLコンテナをバックグラウンド起動している。
```

### Q2. `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/lyra`の`127.0.0.1`は何か

答え:

```text
APIをホストPC上で動かしているため、PC自身を指す。
Postgresコンテナは5432番をホストに公開しているので接続できる。
```

### Q3. `docker compose down -v`をすると何が起きるか

答え:

```text
Postgresコンテナだけでなく、DBデータを保存しているvolumeも削除される。
ローカルDBは初期化される。
```

### Q4. Dockerfileで`COPY package.json bun.lock ./`を先にしている理由は何か

答え:

```text
依存インストールのDocker layerをキャッシュしやすくするため。
ソースコード変更だけならbun installを再実行せずに済む可能性が高い。
```

### Q5. Lyra本番でAPIとworkerは別イメージか

答え:

```text
基本的には同じイメージを使う。
ECS task definitionの起動コマンドを変えてAPIとworkerを分ける。
```

### Q6. `.env`をDockerイメージに入れてはいけない理由は何か

答え:

```text
OpenAI、Stripe、AWSなどの秘密情報がイメージに焼き込まれ、ECRやローカルpull先に漏れる可能性があるため。
```

### Q7. `EXPOSE 3000`を書けばブラウザからアクセスできるか

答え:

```text
できない。
ローカルでは docker run -p 3000:3000 のようなポート公開が必要。
本番ではECS task definition、security group、ALBなどの設定が必要。
```

---

## 37. LyraのDocker構成を自分で説明するなら

初心者が最終的に説明できるべき内容は次です。

```text
Lyraでは、ローカル開発のPostgreSQLをDocker Composeで動かしている。
APIとフロントは通常ホストPC上で起動する。

本番ではDockerfileからAPI/worker共通のイメージを作り、
ECRにpushし、ECS Fargateで動かしている。
APIはHTTPを受け、workerはSQSから重い生成ジョブを受け取る。

Dockerイメージにはコードとビルド成果物だけを入れ、
OpenAIやStripeなどの秘密情報はSecrets Managerから起動時に読み込む。

Docker Composeのvolumeにより、ローカルPostgreSQLのデータは
コンテナを作り直しても残る。
ただし docker compose down -v を使うとDBデータも消える。
```

これを自分の言葉で説明できれば、LyraにおけるDockerの基本は理解できています。

---

## 38. 次に学ぶべきこと

Dockerの基礎を理解したら、次はこの順番で学ぶとよいです。

1. Dockerfileのレイヤーとキャッシュ
2. Docker Composeのネットワーク
3. volumeとbind mountの違い
4. 環境変数とSecrets管理
5. ECRへのpush
6. ECS task definition
7. ECS serviceとローリングデプロイ
8. CloudWatch Logsでコンテナログを見る
9. コンテナのヘルスチェック
10. イメージの脆弱性スキャン

Lyraの本番運用まで理解するには、Docker単体だけでなく、ECS、ECR、SQS、RDS、Secrets Manager、ALB、CloudFrontまでつながりで理解する必要があります。

---

## 39. 参考リンク

- Docker Get Started 日本語版: https://docs.docker.jp/get-started/
- Docker Desktop: https://docs.docker.jp/desktop/
- Docker Compose: https://docs.docker.jp/compose/
- PostgreSQL Docker Official Image: https://hub.docker.com/_/postgres

