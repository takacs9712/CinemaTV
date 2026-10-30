# Cinema TV · Samsung Home Theater

Magyar médiaközpont Samsung Tizen TV-hez, Windows PC-s filmkiszolgálóval. A célkészülék a Samsung UE55TU7092UXXH; a Tizen projekt minimuma 5.5. A PC-s előnézet és a telepíthető TV-app ugyanazt a felületet használja, eltérő eszközfunkciókkal.

## Mit tud ez a kiadás?

- Közös kezdőlap streamingcsempékkel, saját filmekkel, folytatással és kedvencekkel.
- Netflix, YouTube, Prime Video, Disney+, HBO Max / Max, Apple TV, Spotify, Plex, Jellyfin és Emby szolgáltatáscsempék. A csempe jelenléte nem jelenti, hogy a szolgáltató támogatja az adott TV-t vagy régiót.
- Telepített Tizen-appban a TV által visszaadott látható alkalmazások felismerése és indítása; a találatok tartós mentése, kedvenc appok rögzítése a kezdőlapra, legutóbb sikeresen indított appok. Nincsenek kitalált vagy régiófüggetlennek feltételezett appazonosítók.
- PC böngészőből a párosított TV saját streamingalkalmazásának indítása. Csak olyan TV választható, amely az adott telepített szolgáltatást indíthatónak jelezte. Egyetlen megfelelő TV esetén a csempe közvetlenül küldi az indítást; több TV esetén képernyőválasztó jelenik meg. Nincs szolgáltatói weboldalra irányítás.
- A PC médiamappájának beolvasása; videóátvitel helyi hálózaton, HTTP Range támogatással. Folytatási pozíció, megnézettség, kedvencek.
- Célzott TV-telepítésnél automatikus PC-kapcsolat, cím- és kódbeírás nélkül. A TV elmenti a párosítást, és hálózati kiesés után automatikusan újrapróbálkozik.
- PC-ről indítás aktív, párosított Cinema TV fogadóra; saját filmnél szünet, folytatás, tekerés és leállítás. A TV menüben külön engedélyezhető a fogadás; a parancsok rövid ideig élnek. Streamingnél az alkalmazás indítása támogatott, a szolgáltató lejátszóját annak saját távirányításával kell kezelni. Ez nem TV-ébresztés.
- Valós qBittorrent letöltés külön profilban: saját .torrent import, magnet, méret- és szabadhelyellenőrzés, szüneteltetés, folytatás, seedelés. A kész videó bekerül a médiatárba.
- Opcionális TMDb-katalógus saját API Read Access Tokennel; a kiválasztott filmhez kapcsolható saját torrent.
- TV-n AVPlay lejátszási útvonal és USB olvasási lehetőség; PC-n HTML-videólejátszó. Távirányítós fókusz és médiagombok.

A streaming a szolgáltató saját alkalmazásában, saját fiókkal fut. A Cinema TV nem tartalmaz Netflix-előfizetést, nem helyettesíti a szolgáltatók DRM-lejátszóját, és nem importálja a privát streamingkatalógusokat vagy azok nézési előzményeit. A Samsung Home gombja továbbra is a Smart Hubot nyitja meg; automatikus rendszerlauncher-csere nincs.

## Gyors használat ezen a PC-n

1. Indítsd a `START-CINEMA-TV.cmd` fájlt. Szükséges: telepített Python 3.10+ és qBittorrent. Node csak a fejlesztői ellenőrzésekhez kell.
2. A PC-n megnyílik a Cinema TV. Kézzel is megnyitható: [helyi kezdőlap](http://127.0.0.1:8790/).
3. A Kezdőlapon válassz streamingcsempét. A telepített TV-kiadás egy kattintással megnyitja a felismert saját TV-alkalmazást. A PC-s felület az aktív, párosított TV-nek küld indítást. A TV-n a telepített Cinema TV és a PC-s indítás fogadása szükséges; a TV böngészője ehhez nem elegendő. Az alkalmazásváltás után a Cinema TV háttérbe kerülhet: újabb PC-s indításhoz előbb térj vissza hozzá a TV-n. Nincs automatikus Samsung- vagy szolgáltatói bejelentkezés.
4. A saját filmekhez válaszd a Könyvtárat. Új fájlok után használd a „Médiatár frissítése” gombot. A teljes filmhez a PC és a hálózat maradjon elérhető.
5. Letöltéshez a PC-n: Letöltések → Torrentfájl importálása; vagy adj meg saját magnet linket. Csak használatra jogosult forrásokat adj meg. Az app nem jelentkezik be torrentoldalra.
6. Az elkészült letöltés mellett megjelenik a Lejátszás. Ha a TV-n az „Indítás, amint elkészül” gombot választottad és az automatikus indítás be van kapcsolva, az adott eszközön indul a kész film. A PC-n kiválasztott várakozás nem irányítja automatikusan a TV képernyőjét.
7. TMDb borítókhoz a PC-n: Beállítások → TMDb-katalógus → saját API Read Access Token. A token titkosítva a Windows-fiókhoz kötve tárolódik.

Az indító automatikusan felismeri a PC helyi címét. Kézzel megadható PowerShellben, például:

```powershell
.\START-CINEMA-TV.ps1 -Library 'forrás'
```

A fenti IP példa; a valódi címet az indító és a futási könyvtár connection.txt fájlja mutatja. A saját TV-re célzottan készített új csomag az elmentett cím után a PC nevét és a helyi hálózatot is ellenőrzi. Otthoni DHCP-címváltozás miatt nem kell új csomagot telepíteni vagy új párosítókódot megadni.

### Automatikus kapcsolódás a saját TV-n

Indítsd el a PC-s szervert, majd a TV Alkalmazások menüjéből a Cinema TV-t. A célzott csomag a telepítéskor beállított helyi PC-hez csatlakozik; nem kell szervercímet vagy párosítókódot beírni. A sikeres kapcsolat jelzése: **PC csatlakoztatva**. Ez a már működő otthoni hálózaton történő kapcsolódás; a TV Wi-Fi-beállítását nem végzi el.

A célzott, saját tanúsítvánnyal aláírt csomag tartós eszközhitelesítést tartalmaz. Az első használat sem jár le 15 perc után; a TV IP-címe nem eszközazonosító. A TV elmenti a szerverhez tartozó eszköztokent, és a PC újraindítása után is megmarad a kapcsolat. Az eszközazonosság a PC `runtime` könyvtárában marad, ezért ezt nem szabad törölni egy frissítéskor. Ez a változtatás új TV-csomagot igényel; a régebbi, 15 perces engedélyt tartalmazó telepítés magától nem frissül.

PC-kereséskor a TV előbb az utolsó címet és a PC nevét próbálja, majd a TV jelenlegi és a korábbi PC-cím privát /24 tartományát. Legfeljebb 8 kérés fut párhuzamosan, csak a Cinema TV portján. A TV friss véletlen kihívásra adott HMAC-SHA-256 bizonyítékkal ellenőrzi a saját PC-jét, mielőtt bármilyen hitelesítő adatot elküldene. Ehhez a Samsung Network API és a Web Cryptography API szükséges; idegen szerver nem fogadható el pusztán a neve alapján. A keresés legfeljebb 60 másodperc, sikertelenség után 8 másodpercenként újra indulhat; egy elakadt normál API-kérés legfeljebb 25 másodperc után jár le. Eltérő VLAN, vendéghálózat, kliensizoláció és a két keresett /24 tartományon kívülre költözés külön hálózati beállítást igényel.

A privát engedély kizárólag a figyelmen kívül hagyott `.buildResult` és `build` könyvtárakba kerül. A forrásban és a HTTP-n kiszolgált `bootstrap.js` fájlban nincs párosítási titok. A Samsung widgetek `file://` eredetű kéréseit a szerver kezeli, de az eszközhitelesítés, a helyi hálózat és a Host ellenőrzése továbbra is szükséges.

Az ezen a PC-n már elkészített, aláírt frissítés telepítéséhez: kapcsold be a TV-t, majd az aktív `A:\TVLauncher\tizen-cinema` mappában indítsd az **UPDATE-SAMSUNG-TV.cmd** fájlt. Ez automatikusan keresi a fejlesztői kapcsolatot, csak a beállított UE55TU7092UXXH típus egyetlen találata esetén telepít, majd elindítja a Cinema TV-t. IP-címet vagy kódot nem kér. A Developer Mode ON és az SDK megléte továbbra is a fejlesztői frissítés feltétele; mindennapi filmnézéshez nincs szükség nyitott fejlesztői kapcsolatra.

## Saját film indítása a PC-ről Wi-Fi-n

1. A PC szervere fusson. A TV-n nyisd meg a telepített Cinema TV-t; a célzott csomag automatikusan párosít és csatlakozik. Általános csomagnál vagy TV-böngészőben kézi párosítás szükséges.
2. A TV-n a Cinema TV felső TV menüjében állítsd BE állapotba a „PC-s indítás fogadása ezen a képernyőn” kapcsolót. A telepített Tizen-kiadásban kezdetben be van kapcsolva; a böngészőben külön kell engedélyezni. Hagyd nyitva az appot az előtérben.
3. A PC-n: Könyvtár → válassz filmet → Lejátszás a TV-n → válaszd a TV-t → Film indítása ezen az eszközön.
4. A PC-n a TV menüben szüneteltethetsz, folytathatsz, tekerhetsz és leállíthatsz. A fogadó visszajelzett állapota megjelenik a listában. Böngészős fogadón az automatikus lejátszást a böngésző blokkolhatja; ilyenkor egyszer a TV-n OK / Folytatás szükséges.

Ehhez elegendő a közös helyi hálózat: a TV lehet Wi-Fi-n, a PC lehet Wi-Fi-n vagy kábelen ugyanahhoz a routerhez csatlakoztatva. Az indítás a PC-n tárolt fájlt játssza le hálózaton. Nem másolja a TV USB-lemezére, így a PC kikapcsolása megszakítja a lejátszást. A TV saját USB-filmlistája külön funkció. A Netflix és más streaming szolgáltató tartalma a szolgáltató saját appjában marad.

## Távirányító: OK, Vissza és kijelölés

- **Rövid OK:** egyszer megnyitja a kijelölt elemet. Menüpontnál belép az oldal csempéi közé. Egy lenyomás ismétlődő eseménye nem aktiválhatja az újonnan kijelölt gombot is.
- **Rövid Vissza:** először a felugró ablakot zárja, filmadatlapról ugyanarra a filmcsempére tér vissza, másik oldalról a Kezdőlapra lép. A Kezdőlapon kilépési megerősítést mutat; kezdetben a **Maradok** van kijelölve. Nyomva tartott Vissza ismétlődő app-eseménye nem léptethet több képernyőt egyszerre.
- **Szövegbevitel:** a Samsung billentyűzetének Kész / Mégse eseménye a billentyűzetet zárja, a megnyitott appablakot megtartja. A következő Vissza zárhatja az ablakot.
- **Bal / jobb:** szomszédos csempe ugyanabban a sorban; a sor szélén megáll. **Fel / le:** következő sor, lehetőleg ugyanabban az oszlopban. A felső menüből Le belép a tartalomba; a legfelső tartalom fölött Fel visszavisz a menübe.
- A kijelölés vastag arany keretet kap. A felső menü görgetéskor is elérhető; a fókuszba kerülő csempe automatikusan a látható területre kerül. Lista- és letöltésfrissítéskor megmarad a kijelölt művelet.

A böngészős, 1920×1080 méretű próbán a sor- és oszlopváltás, a film OK-val megnyitása és a Vissza utáni filmcsempe-fókusz igazolva lett. A hosszú lenyomás ismétlése és az IME Kész / Mégse kezelése a valódi app.js eseménykezelőivel futó regressziós tesztben is ellenőrzött; a fizikai távirányító érzetét a TV-n érdemes kipróbálni.

A javított navigációs kiadás a saját Samsung TV-re települt és elindult; a szerver aktív, „Készen áll” állapotú Samsung TV fogadót igazolt. A tulajdonos a fizikai OK / Vissza próbát is sikeresnek jelezte.

A Samsung Smart Remote hosszú Back/Exit nyomása a rendszer **Exit** művelete, ezért visszalépéshez röviden nyomd meg a Vissza gombot. Ez eltér az app által szűrt ismétlődő Back eseményektől. [Samsung távirányító-dokumentáció](https://developer.samsung.com/smarttv/develop/guides/user-interaction/remote-control.html)

## A felismert Netflix, Max és más TV-appok megőrzése

A telepített Cinema TV minden sikeresen felismert, látható TV-alkalmazást elment a TV saját alkalmazástárhelyére. Indításkor az elmentett lista azonnal betöltődik; közben új keresés is indulhat. Az új keresés indulása, hibája, időtúllépése vagy üres / részleges válasza nem törli a korábban megtalált appokat. Emiatt a Netflix és Max csempéje egy átmenetileg hibás beolvasástól nem veszti el a korábban felismert indítási kapcsolatot.

Az új találatok hozzáadódnak a mentett listához. Ha egy friss beolvasás a szolgáltatás új alkalmazásazonosítóját adja vissza, a csempe az új azonosítót jegyzi meg. Ha a TV indításkor kifejezetten jelzi, hogy egy mentett alkalmazás már nincs telepítve, vagy nem látható, az a bejegyzés kikerül a listából. Egy általános API- vagy jogosultsághiba nem jelent eltávolítást. Üres vagy hibás induló keresés után legfeljebb két automatikus újrapróbálkozás történik; kézi frissítés továbbra is az **Alkalmazások → TV-alkalmazások frissítése** gombbal kérhető.

A lista TV-nként, a telepített Cinema TV alkalmazásban tárolódik. A PC-böngésző nem örököl belőle TV-s appindítási jogosultságot. A Cinema TV eltávolítása vagy alkalmazásadatainak törlése a mentést is törölheti. Ha a TV tárhelye nem engedi a mentést, az Alkalmazások oldal külön jelzi; a már beolvasott lista az aktuális futásban akkor is megmarad.

## Telepítés a Samsung TV-re

A böngészős előnézet nem telepíti a TV-appot. A TV böngészője általában nem biztosítja a Tizen alkalmazáskezelő API-t; a natív appindításhoz a telepített, aláírt WGT kell.

1. A PC-re a hivatalos Tizen Studio és Samsung TV Extension szükséges, továbbá a Samsung Certificate Extension.
2. TV: Apps / Alkalmazások képernyő → 12345 → Developer Mode ON → a PC aktuális helyi IP-címe → teljes újraindítás. A TV és PC azonos hálózaton legyen; vendéghálózat és kliensizoláció akadályozhatja a kapcsolatot.
3. Tizen Studio Device Managerben add hozzá a TV IP-címét. A fejlesztői SDB kapcsolatnak a 26101-es TCP-porton működnie kell. Az általános TV-hálózati vagy távirányító-kapcsolat önmagában ezt nem igazolja.
4. Certificate Managerben Samsung TV tanúsítványprofilt kell létrehozni, a készülék DUID-jával. A Samsung-belépést, tanúsítványjelszót és fiókellenőrzést a tulajdonos végzi. A tanúsítványok és jelszavak nem kerülnek ebbe a forrásba.
5. Az aláírt csomag készítése:

```powershell
.\tools\package-tizen.ps1 -CertificateProfile 'SAJAT_PROFILNEV'
```

Automatikus kapcsolódást tartalmazó célzott csomaghoz előbb indítsd a PC-s szervert, majd add meg a TV tényleges helyi címét (az alábbi csak példa):

```powershell
.\tools\package-tizen.ps1 -CertificateProfile 'SAJAT_PROFILNEV' -TvAddress '192.168.1.60'
```

6. A létrejött `build/CinemaTV.wgt` telepíthető a Device Manager / Tizen Studio segítségével a csatlakoztatott TV-re. A külső csomagfájlnév ne tartalmazzon szóközt: a célkészülék telepítője a `Cinema TV.wgt` fájlnevet elutasította, ugyanazt az aláírt csomagot `CinemaTV.wgt` néven sikeresen telepítette. A `build/CinemaTV-unsigned.zip` csak ellenőrzésre használható forráscsomag; átnevezve sem telepíthető.
7. Célzott csomagnál az első indítás automatikusan kapcsolódik a PC-hez; nincs beírandó vagy lejáró TV-kód. Az általános csomagnál add meg a PC indítója által mutatott szervercímet és a friss hatjegyű párosítókódot. A kézi kód 10 percig él. Ez más eszközök kézi hozzáadására szolgál; a saját, automatikusan kapcsolódó TV-hez nem kell.
8. Alkalmazások → TV-alkalmazások frissítése. A felismert szolgáltatásnál „Megnyitás a TV-n” jelenik meg. A lista többi appja közvetlenül is megnyitható, a csillagos gombbal rögzíthető a kezdőlapra. Az engedélyezést és a külső app indítását a firmware korlátozhatja; ilyenkor a felület hibát jelez és a Smart Hub használatát kéri.

Ha csak a streamingappokat szeretnéd használni, a párosítóablakban választható a „Most csak az alkalmazások”. A PC a saját filmek és letöltések kiszolgálásához szükséges.

## Tűzfal és leállítás

A 8790-es portnak a TV felől elérhetőnek kell lennie. Egyetlen TV-címre korlátozott szabály rendszergazda PowerShellben, a TV valódi címével:

```powershell
.\ALLOW-TV-FIREWALL.ps1 -TvAddress '192.168.1.60'
```

Ez a szigorú szabály TV-címváltozásnál frissítést igényel. A címváltozást külön beavatkozás nélkül kezelő megoldás a privát helyi alhálózat engedélyezése. Ez más helyi eszközök számára is elérhetővé teszi a szerver portját; a médiához és vezérléshez továbbra is párosított eszköztoken szükséges. Csak a tulajdonos kifejezett jóváhagyásával futtatandó:

```powershell
.\ALLOW-TV-FIREWALL.ps1 -AllowLocalSubnet
```

Ezen a PC-n a tulajdonos kifejezett jóváhagyása után a privát helyi alhálózati szabály beállítása sikerült és vissza lett ellenőrizve: csak a Cinema TV TCP 8790-es portja, Private profil, LocalSubnet forrás. A TV régi IP-címéhez kötött korlátozás megszűnt.

A fenti TV-IP is példa. Routeres porttovábbítás nem szükséges. A qBittorrent kezelőfelülete kizárólag a PC 127.0.0.1 címén érhető el, külön jelszóval és külön profillal; a médiaközpont HTTP-kapcsolata otthoni hálózatra készült.

Leállítás: `STOP-CINEMA-TV.ps1`. Ekkor a letöltő tovább fut és seedel. A `-AlsoStopDownloader` kapcsoló a Cinema TV saját qBittorrent-folyamatát is leállítja; letöltés/seedelés közben ezt csak szándékosan használd. A PC újraindítása után jelenleg kézzel kell újra elindítani a Cinema TV-t.

## Állapot és korlátok

- A PC-s kezdőlap, HTTP-s filmkiszolgálás és a valós BitTorrent teszt már működött. A teszt a Blender Foundation Sintel CC BY 3.0 mintáját töltötte le helyi webseedből qBittorrenttel, teljes letöltéssel és SHA-256 ellenőrzéssel.
- A Samsung SDB-kapcsolata igazolva: UE55TU7092UXXH, Tizen 5.5. A saját Samsung tanúsítvánnyal aláírt új `CinemaTV.wgt` a valós TV-re sikeresen települt és elindult. A TV cím- és kódbeírás nélkül bejelentkezett, a szerver aktív Samsung TV fogadót igazolt. A TV Netflix, Disney+ és Max natív alkalmazást jelzett indíthatóként. Ez az alkalmazások felismerésének igazolása; nincs állítás valós TV-n sikeres Netflix-indításról.
- A tartós hitelesítést és a címváltozás kezelését a tesztek igazolták; az aláírt csomag PC-azonosságát a futó szerver valóban visszaigazolta. A korábban működő szerver újraindítása után a TV önállóan visszacsatlakozott. Valódi routeres IP-címcsere még nem lett végrehajtva; azt a tesztelt hálózatfelderítés kezeli.
- USB-beolvasás, TV-s AVPlay, a kodekek, többcsatornás hang és a távirányító minden iránya külön készüléktesztet igényel. Automatikus transzkódolás, hangsáv/felirat választó, HDMI-bemenetváltó és közös streaming nézési lista jelenleg nincs.
- A letöltési cél ebben a felállásban a PC médiamappája, nem a TV USB-lemeze. Az USB-lista olvasási lehetőség.
- Dokumentált, engedélyezett nCore interfész nincs konfigurálva; saját torrent importálható. Automatikus keresés, bejelentkezés és minőségi változatválasztás nincs.
- A hálózati filmlejátszás teljes időtartamához a PC-nek működnie kell. A TV-hez csatlakoztatott, támogatott USB-videó olvasása lehet PC-től független; ez még nincs a konkrét készüléken tesztelve.
- A runtime könyvtár titkosított jelszavakat, párosított eszközöket és helyi adatbázist tartalmaz. Nincs a Gitben vagy a csomagban; ne oszd meg.

## Fejlesztői ellenőrzések

```powershell
python -m unittest discover -s tests -v
node --check tv/app.js
node --check tv/apps.js
node tests/test_apps.js
node tests/test_connection.js
node tests/test_reconnect.js
node tests/test_remote_keys.js
python tools/build_widget.py
```

23 Python teszt ellenőrzi többek között a kézi és automatikus párosítást, a tartós eszközhitelesítést idő-, IP-cím- és folyamatváltozás után, a hitelesített PC-felismerés szerveroldalát, párhuzamos újrapróbálkozást, a Samsung `file://` hálózati eredetét, médiahozzáférést, Range-kéréseket, a torrentválaszokat, útvonalvédelmet, befejezetlen filmek kizárását és a távirányítóparancsokat. 14 JavaScript alkalmazásteszt mellett a kapcsolódási teszt valódi Web Crypto HMAC-ellenőrzéssel vizsgálja a PC és a TV címváltozását, a hamis szerver elutasítását, a hitelesítő adat nélküli keresést és a párhuzamossági korlátot. Az alkalmazástesztek a lista újraindítás utáni visszatöltését, üres és részleges listák megtartását, API-hibát, időtúllépést, új szolgáltatásazonosítót, igazolt eltávolítást, tárhelyhibát és a korlátozott újrapróbálkozást is ellenőrzik. A visszacsatlakozási teszt a valódi app.js felületét futtatja kiesésen, helyreálláson és egy korábbi kérés késve érkező időtúllépésén keresztül; nem kér PIN-t, és az elavult hiba nem ronthatja el az új kapcsolatot. A TV API-kat ezekben helyettesítő tesztobjektum adja; ez nem készülékteszt. Windows sandboxban az ideiglenes DPAPI-fájlok átnevezése tiltott lehet; normál helyi PowerShellben a tesztek lefutnak.

## Hivatalos dokumentáció

- [Samsung Application API](https://developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api-references/application-api.html)
- [Tizen alkalmazáskezelés](https://github.com/Samsung/tizen-docs/blob/master/docs/application/web/guides/app-management/app-controls.md)
- [Samsung TV fejlesztői kapcsolat](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html)
- [Samsung TV tanúsítványok](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html)
- [Samsung AVPlay](https://developer.samsung.com/smarttv/develop/guides/multimedia/media-playback/using-avplay.html)

Ez külön Tizen + Windows projekt a cleanyourtv saját használatú könyvtárában. Az Android launcher és a Samsung Smart Hub két eltérő rendszer; az Android launcher APK nem telepíthető Tizenre.
