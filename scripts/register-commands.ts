/**
 * One-shot slash command registration.
 *   DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... npm run register
 * Global commands can take up to an hour to propagate; set DISCORD_GUILD_ID
 * during development for instant registration in a single server.
 */
export {};

const APP_ID = process.env.DISCORD_APP_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!APP_ID || !BOT_TOKEN) {
  console.error('DISCORD_APP_ID と DISCORD_BOT_TOKEN が必要です。');
  process.exit(1);
}

const SUB_COMMAND = 1;
const SUB_COMMAND_GROUP = 2;
const STRING = 3;

const commands = [
  {
    name: 'ctf',
    description: '今週のCTF情報を取得・設定します',
    options: [
      { type: SUB_COMMAND, name: 'next', description: '今週のCTF一覧を今すぐ表示します' },
      {
        type: SUB_COMMAND_GROUP,
        name: 'config',
        description: '通知の絞り込み条件を設定します',
        options: [
          { type: SUB_COMMAND, name: 'show', description: '現在の設定を表示します' },
          { type: SUB_COMMAND, name: 'reset', description: '設定を初期値に戻します' },
          {
            type: SUB_COMMAND,
            name: 'set',
            description: '設定値を変更します',
            options: [
              {
                type: STRING,
                name: 'key',
                description: '変更する項目',
                required: true,
                choices: [
                  { name: 'days（先読み日数）', value: 'days' },
                  { name: 'online_only（オンラインのみ）', value: 'online_only' },
                  { name: 'include_restricted（参加制限つきも含む）', value: 'include_restricted' },
                  { name: 'weight_min（最小weight）', value: 'weight_min' },
                  { name: 'max_events（最大表示件数）', value: 'max_events' },
                ],
              },
              { type: STRING, name: 'value', description: '設定する値', required: true },
            ],
          },
        ],
      },
    ],
  },
];

const url = GUILD_ID
  ? `https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD_ID}/commands`
  : `https://discord.com/api/v10/applications/${APP_ID}/commands`;

const response = await fetch(url, {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bot ${BOT_TOKEN}`,
  },
  body: JSON.stringify(commands),
});

if (!response.ok) {
  console.error(`登録に失敗しました: ${response.status}`);
  console.error(await response.text());
  process.exit(1);
}

console.log(`✅ コマンドを登録しました (${GUILD_ID ? `guild ${GUILD_ID}` : 'global'})`);
