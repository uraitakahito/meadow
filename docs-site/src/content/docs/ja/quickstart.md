---
title: クイックスタート
description: meadow をライブラリとして、またはコンテナとして動かし、別 VM のブラウザから到達させる
---

同じサーバを動かす方法が 2 つあります。
どちらが必要かは、**実ブラウザが到達する必要があるか**で決まります。

## ライブラリとして

ブラウザを介さずに HTTP の挙動を試すテスト向け。
`app.inject()` はプロセス内でアプリを叩くので、
**ソケットを開かず**、ポートの確保も要らず、後始末はアプリを閉じるだけです。

```ts
import { buildFixture, scenarios } from "meadow";

const app = buildFixture();

const res = await app.inject(scenarios.status(503));
// res.statusCode === 503

await app.close();
```

テストファイルごとに 1 つ作り、teardown で閉じてください。
`buildFixture()` は軽量です ― ルートを登録して返すだけで、
`listen()` を呼ぶまで何も待ち受けません。

:::caution[ライブラリ形態はブラウザに応答できません]
`app.inject()` はネットワークスタックに一切触れないので、**Chrome からは到達できません**。
`/lazy`・`/redirect-page`・`/banner` のように
**ブラウザ自身の挙動**が主題のシナリオには、コンテナが必要です。
:::

## コンテナとして

主経路です。キャプチャワーカーの Chrome は自分の VM で動くため、
meadow にはネットワーク越しに IP か DNS 名で到達できる必要があります。

```sh
container build -t meadow .
container run -d --name meadow meadow

# アドレスを調べて、起動を確認する
container ls
curl -sf http://<meadow-ip>:8080/health
```

Apple Container でプロジェクト DNS ドメインを使っている場合は名前で届きます ―
BrowserHive のスタックでは `meadow.browserhive:8080` です。

### 設定

| 変数 | 既定値 | 備考 |
| --- | --- | --- |
| `MEADOW_PORT` | `8080` | 待ち受けポート |
| `MEADOW_HOST` | `0.0.0.0` | 別 VM から届くよう全インターフェースにバインド |

`0.0.0.0` という既定値こそが要点です。
ループバックにバインドしてしまうと**ブラウザの VM から到達できなくなり**、
コンテナで動かす意味そのものが失われます。

## 起動を待つ

サーバが応答すること以外に準備完了の合図は無いので、`/health` をポーリングします。

```sh
until curl -sf "http://${MEADOW_IP}:8080/health" >/dev/null; do sleep 1; done
```

利用側は統合テストのセットアップでこれを行っています。
**コンテナの起動コマンドは、中のプロセスが待ち受けを始めるずっと前に戻る**からです。

## テストの書き方

利用側のテストが取る典型的な形です。

```ts
import { scenarios } from "meadow";

const origin = `http://${meadowIp}:8080`;

beforeEach(async () => {
  // ヒット数も flaky の状態もプロセス内に残る。スイートごとではなく
  // テストごとにクリアする。
  await fetch(`${origin}/__reset`, { method: "POST" });
});

it("失敗するオリジンに対してリトライし、最終的に成功する", async () => {
  // このアサーション専用の key。並行するテストが同じ失敗予算を
  // 食い合わないようにする。
  await capture(origin + scenarios.flaky(2, "retry-until-success"));

  const hits = await (await fetch(`${origin}/__hits`)).json();
  expect(hits[scenarios.flaky(2, "retry-until-success")]).toBe(3);
});
```

各ルートが何を再現するのか、`key` がなぜ重要なのかは
[シナリオ](/scenarios/)にあります。
