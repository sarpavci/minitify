# minitify — Tasarım Dokümanı

**Tarih:** 2026-10-25
**Durum:** Onaylandı, implementasyona hazır

## 1. Amaç

Spotify'ı terminalden kontrol etmek için minimal bir araç. İki asıl kısıt, projenin
tüm teknik kararlarını belirliyor:

1. **Dock'ta uygulama görünmemeli.** Spotify desktop'ın her açıldığında dock'u işgal
   etmesi kullanıcının asıl şikâyeti.
2. **Düşük kaynak tüketmeli.** Spotify desktop 400-600 MB RAM kullanıyor.

Kullanıcı deneyimi hedefi: görsel zenginlik değil, hız ve basitlik. Kullanıcı ya bir
playlist seçecek ya da şarkı araması yapacak; işi bitince terminal yoluna devam etmeli.

Electron ve benzeri gömülü tarayıcı çerçeveleri baştan reddedildi.

## 2. Doğrulanmış Bulgular

Bu tasarım, 2026-10-25 tarihinde yapılan fizibilite çalışmasının sonuçlarına dayanıyor.
Aşağıdaki maddelerin hepsi ölçümle doğrulandı; varsayım değiller.

### 2.1 librespot yolu kapalı

Spotify, librespot ailesindeki istemcilere şarkı şifre çözme anahtarını (AES audio key)
vermiyor. Üç ayrı araçta doğrulandı:

| Araç | Hata |
|---|---|
| spotify_player 0.25.1 | `error audio key 0 1` |
| librespot 0.8.0 (çıplak) | `error audio key 0 1` |
| go-librespot 0.10.5 | `Spotify refused the audio key (code 1)` |

Her üçünde de OAuth girişi, Connect cihaz keşfi, transfer ve şarkı yükleme sorunsuz
çalışıyor; yalnızca anahtar reddediliyor. Hesabın Premium olduğu Web API `/v1/me`
çağrısıyla bağımsız olarak doğrulandı (`product=premium`), yani sorun abonelik değil.

Reddin geçici bir hız sınırı olmadığı ayrıca test edildi: 4 dakika tam sessizlikten
sonra gönderilen ilk tek şarkı isteği de reddedildi. Hız sınırı olsaydı bu bekleme
onu sıfırlardı.

### 2.2 Nedeni: terk edilmiş protokol

`/Applications/Spotify.app` (sürüm 1.3.6.1921) incelendiğinde sebep netleşti.
Resmi uygulama, librespot'un taklit ettiği eski AES audio key protokolünü **artık
hiç kullanmıyor**:

- Ana binary'de `AudioKeyRequest`, `audiokey`, `hm://audio/key` gibi izler yok.
  Tek eşleşme `hm://audio-attributes/v1/audio-analysis/`, o da ses analizi.
- Yerine modern DRM var: `spotify.contentagnostic.v2.FairPlay`, `license_url`,
  `license_server_endpoint`, `cpp-audio-drm_setup_impl`, `playback_error_drm_denied`.
- Chromium Embedded Framework binary'sinde `com.widevine.alpha`,
  `Media.EME.RequestMediaKeySystemAccess`, `media.mojom.CdmFactory` bulunuyor.
  Widevine CDM paketle gelmiyor; `widevine_update_on_login` ile girişte indiriliyor.

Yani librespot 11 aydır açık olan bir hatayla değil, kaldırılmış bir sistemle
uğraşıyor. Düzeltilme ihtimali yok.

### 2.3 Çözüm: resmi SDK, hafif motor

Spotify Web Playback SDK, macOS'un yerleşik WebKit motorunda (WKWebView) sorunsuz
çalışıyor. Ölçülen değerler:

| Motor | Bellek (phys_footprint) | Süreç | Durum |
|---|---|---|---|
| librespot | 23 MB | 1 | Çalmıyor |
| Headless Chrome | 434 MB | 10 | Çalışıyor |
| **WKWebView** | **75 MB** | **4** | **Çalışıyor** |
| Spotify desktop | 400-600 MB | çok | Çalışıyor, dock'ta görünür |

Doğrulama: şarkı 9157 ms konumunda, `minitify-poc` cihazında çaldı; `pmset -g assertions`
çıktısında `coreaudiod` çıkış cihazına (AirPods) output context açtı.

Bu mimari, resmi uygulamayla **aynı yolu** kullanıyor: tarayıcı motoru + EME + lisans
sunucusu. Fark, Spotify'ın 333 MB'lık Chromium'u yanında taşıması, bizim sistemin
zaten yüklü WebKit'ini kullanmamız.

## 3. Mimari

```
minitify (CLI)  ──unix socket──>  minitifyd (Node daemon)
 ince kumanda,                     ├─ HTTP sunucusu → SDK sayfası (127.0.0.1)
 iş bitince ölür                   ├─ OAuth + token yenileme
                                   ├─ Spotify Web API istemcisi
                                   └─ spawn → wkplayer (Swift/WKWebView)
                                               ├─ Connect cihazı "minitify"
                                               └─ MPRemoteCommandCenter (media tuşları)
```

### 3.1 Neden bu üç parça

**Node daemon ayrı:** SDK sayfası `127.0.0.1` üzerinden servis edilmek zorunda.
EME yalnızca secure context'te çalışıyor; `loadHTMLString` ile gelen `about:blank`
origin'i bunu karşılamıyor. POC'ta doğrulandı.

**wkplayer ayrı süreç:** Swift tarafı yalnızca bir WKWebView kabuğu ve media tuşu
köprüsü. Tüm mantık Node'da kalıyor. Daemon ölürse player de ölüyor (child process).

**CLI ince:** Komut çalışır, daemon'a tek satır gönderir, çıkar. Terminal meşgul
edilmiyor; müzik daemon'da yaşıyor.

### 3.2 Yaşam döngüsü

Terminal uygulaması kapandığında müzik devam eder. Daemon ilk komutta sessizce
başlar, `minitify quit` ile durur. Kullanıcı daemon'un varlığını normalde fark etmez.

Daemon tek örnek olarak çalışır; socket `~/.config/minitify/daemon.sock` yolunda
tutulur. CLI önce socket'e bağlanmayı dener, bağlanamazsa daemon'u başlatıp tekrar
dener. Artık kalmış socket dosyası (daemon çökmüşse) bağlantı hatasında silinir.

## 4. Bileşen Sorumlulukları

| Bileşen | Sorumluluk | Bağımlılık |
|---|---|---|
| `bin/minitify` | Komut ayrıştırma, daemon'a bağlanma, seçici arayüz | Yok |
| `src/daemon/server.js` | Unix socket sunucusu, komut yönlendirme | Yok |
| `src/daemon/http.js` | SDK sayfasını servis etme (127.0.0.1) | Yok |
| `src/spotify/auth.js` | OAuth akışı, token saklama ve yenileme | Yok |
| `src/spotify/api.js` | Web API çağrıları (playlist, arama, çalma) | Yok |
| `src/player/control.js` | Player durumu, wkplayer süreç yönetimi | Yok |
| `player/wkplayer.swift` | WKWebView kabuğu, media tuşları, Now Playing | MediaPlayer, WebKit |

Her birim tek bir işten sorumlu ve arayüzü üzerinden test edilebilir. `api.js`
dışarıya saf fonksiyonlar sunar; HTTP çağrısı enjekte edilebilir bir `fetch`
üzerinden yapılır, böylece testte taklit edilebilir.

## 5. Akışlar

### 5.1 İlk kurulum

```
minitify login
  → tarayıcıda Spotify onay sayfası
  → 127.0.0.1:8888/callback ile kod yakalanır
  → token + refresh_token → ~/.config/minitify/tokens.json (0600)
```

Bir kez yapılır. Sonraki çalışmalarda `refresh_token` ile sessizce yenilenir.

`client_id` ve `client_secret` `~/.config/minitify/config.json` dosyasında tutulur.
Kullanıcı kendi Spotify Developer uygulamasını açar; Development Mode kişisel kullanım
için yeterli (uygulama başına 5 kullanıcı limiti var).

### 5.2 Çalma

```
minitify
  → daemon ayakta değilse başlat (sessiz)
  → GET /me/playlists → seçici
  → kullanıcı seçer
  → wkplayer hazır değilse bekle (en fazla 5 sn)
  → PUT /me/player/play?device_id=...
  → CLI kapanır, müzik devam eder
```

### 5.3 Media tuşları

```
klavyedeki play/pause tuşu
  → MPRemoteCommandCenter handler (Swift)
  → stdout üzerinden daemon'a olay
  → daemon: PUT /me/player/pause
  → MPNowPlayingInfoCenter güncellenir
```

Şarkı bilgisi (ad, sanatçı, süre, konum) `MPNowPlayingInfoCenter`'a beslenir;
böylece Control Center ve kilit ekranında da görünür.

## 6. Komut Seti

| Komut | İş |
|---|---|
| `minitify` | Playlist seçici (interaktif) |
| `minitify search <kelime>` | Arama sonuçları seçici |
| `minitify status` | Çalan şarkıyı yazdır ve çık |
| `minitify next` / `prev` / `pause` | Anlık kontrol |
| `minitify vol <0-100>` | Ses seviyesi |
| `minitify login` | İlk kurulum / yeniden yetkilendirme |
| `minitify quit` | Daemon ve player'ı kapat |

Seçici açıldığında, listenin üstünde o an çalan şarkı tek satır olarak gösterilir;
kullanıcı neyin çaldığını görmek için ayrı komut çalıştırmak zorunda kalmaz.

Tüm komutlar ve kullanıcıya görünen mesajlar İngilizce.

**Arama limiti:** Spotify Web API arama sonuç limiti Şubat 2026'da 50'den 10'a
düşürüldü. Seçici bunu gizlemeyecek; 10 sonuç gösterip aramayı daraltmayı önerecek.
Sayfalama yapıp kullanıcıyı boş listelerle oyalamanın anlamı yok.

## 7. Hata Durumları

| Durum | Davranış |
|---|---|
| Daemon yok | Otomatik başlat, kullanıcıya gösterme |
| Token süresi dolmuş | Sessizce yenile |
| Yenileme başarısız | `minitify login` öner |
| Player hazır değil | "preparing" göster, 5 sn bekle, sonra açık hata |
| Ağ yok / Spotify 5xx | Ne olduğunu söyle, sessizce yutma |
| Premium değil | SDK `account_error` verir; anlamlı mesaj göster |
| Kota aşımı (429) | `retry_after` değerini kullanıcıya söyle |

## 8. Test Stratejisi

Yalnızca birim test, mütevazı kapsamda. Hedef kapsama oranı değil, kırılgan
noktaları tutmak:

- `api.js`: istek kurulumu ve yanıt ayrıştırma, enjekte edilen `fetch` ile
- `auth.js`: token yenileme mantığı, süresi dolmuş token tespiti
- Komut ayrıştırma: argüman eşleme ve hata mesajları

Test edilmeyecekler: WKWebView entegrasyonu, DRM, gerçek Spotify çağrıları,
media tuşları. Bunlar test ortamında taklit edilemez; manuel doğrulanacak.

Çalıştırma: `node --test`. Test çerçevesi bağımlılığı yok.

## 9. Teknik Kararlar

- **Node, sıfır runtime bağımlılığı.** Seçici arayüz, HTTP sunucusu, OAuth, socket —
  hepsi yerleşik modüllerle. `node_modules` yok, `npm install` yok.
- **Swift player `swiftc` ile derlenir**, Xcode gerekmez. Build script repoda.
  POC'ta Command Line Tools ile derlendiği doğrulandı (76 KB binary).
- **Dock'ta görünmeme:** `NSApplication.setActivationPolicy(.accessory)`. Pencere
  ekran dışına konur ve `orderOut` ile gizlenir.
- **Otomatik çalma:** `WKWebViewConfiguration.mediaTypesRequiringUserActionForPlayback`
  boş dizi olmalı, yoksa SDK ses başlatamaz.

## 10. Riskler

| Risk | Etki | Azaltma |
|---|---|---|
| Media tuşları WKWebView'ın Now Playing kaydıyla çakışabilir | Tuşlar yanlış hedefe gider | İmplementasyonun ilk adımında doğrulanacak; çakışma varsa Swift tarafında Now Playing sahipliği açıkça üstlenilir |
| Spotify SDK'yı veya DRM'i değiştirirse | Çalma bozulur | Resmi SDK kullanıldığı için Spotify'ın kendi güncellemesiyle birlikte gelir; librespot'taki gibi ters mühendislik borcu yok |
| Development Mode kota sınırları | 429 hataları | Kendi `client_id`'miz kullanılıyor; kişisel kullanımda sınıra yaklaşılmaz |
| Token dosyası sızması | Hesap erişimi | Dosya izni 0600, `~/.config/minitify/` altında |

## 11. Kapsam Dışı

Bu sürümde yapılmayacak, ileride değerlendirilecek:

- **Menü çubuğu arayüzü veya tüm ekranlarda görünen overlay mini uygulama.**
  Fikir olarak planda duruyor; bu aşamada araştırma yapılmadı, tasarımı yok.
- Çalma listesi düzenleme, şarkı beğenme, kuyruk yönetimi
- Podcast ve sesli kitap desteği
- Birden fazla Spotify hesabı
- Linux veya Windows desteği (WKWebView macOS'a özgü)
