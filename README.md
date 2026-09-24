# AMAR STR Bot — Railway Ready

Fitur utama:
- WhatsApp bot via Baileys
- Pairing code atau QR
- Auto reconnect
- Persistent session untuk Railway Volume
- 🎮 hanya satu game: Snake, dengan kartu visual
- 🎵 downloader TikTok untuk URL TikTok publik menggunakan yt-dlp
- `/health` endpoint untuk Railway

## Command

- `!menu`
- `!snake`
- `!up` / `!down` / `!left` / `!right`
- `!snake stop`
- `!tiktok https://www.tiktok.com/...`
- `!ping`
- `!runtime`
- `!info`

## Railway

1. Upload repository ini ke GitHub.
2. Railway → New Project → GitHub Repository.
3. Deploy repository.
4. Buat Volume dan mount ke `/data` agar `AUTH_DIR=/data/session` tetap ada.
5. Set variable `PAIRING_NUMBER` ke nomor WhatsApp format internasional tanpa `+`.
6. Buka Deploy Logs dan ambil pairing code jika diminta.
7. Di WhatsApp: Linked devices → Link a device → Link with phone number.

## Catatan TikTok

Downloader hanya menerima domain TikTok. yt-dlp memang menyediakan extractor TikTok, tetapi situs dapat berubah sehingga suatu URL bisa sewaktu-waktu gagal. Gunakan hanya untuk konten yang kamu berhak simpan.

### Spotify

Use `!spotify <Spotify track link>` or `!music <Spotify track link>`. The bot reads public Spotify track metadata and sends a player-style card plus the original Spotify link. Spotify full-track playback is not downloaded by the bot; Spotify's Web Playback SDK requires user authorization and a Premium account.

## Visual verified-style header
`!menu` now sends a visual bot header with a blue-check-style badge. This is only a UI graphic inside the bot's menu image; it does **not** create or claim an official Meta/WhatsApp verification badge.

## WhatsApp Channel Emoji

Set `CHANNEL_LINK` in Railway Variables to the full WhatsApp Channel invite link. The bot resolves the link to the channel `@newsletter` JID automatically. `CHANNEL_JID` remains as an optional fallback. Then use:

```text
!emoji10🤩
!emoji 10 🤩
```

The bot limits the count to `MAX_EMOJI_COUNT` (default 30) to avoid accidental message floods. The WhatsApp account must have permission to post in the channel.
