# Accord · Raccolta album PWA

## PWA 1.15.4 · Paginazione TIDAL senza prefisso API

- Nei link alla pagina successiva il prefisso /v2 puo' essere ripristinato
  solo per lo stesso host/protocollo e l'identico percorso della risorsa
  corrente senza prefisso. Non sono ammessi altri host, risorse o versioni.
- Cursori preservati; invariati controlli URL, limiti di lettura e politica
  richieste. Modifica locale, non ancora pubblicata.

## PWA 1.15.3 · Ritmo adattivo TIDAL e creazione playlist

- TIDAL: almeno 1 s fra richieste; dopo un 429, almeno 5 s, poi raddoppio
  fino a 60 s. Ritmo appreso persistente fra schede/riavvii, senza
  accelerazione automatica dopo successi. Cooldown delle versioni
  precedenti, anche scaduto, porta il ritmo iniziale ad almeno 5 s.
- Retry-After e' un minimo, non un invito a ripartire subito al ritmo
  precedente. Nessuna quota numerica ufficiale garantita; richieste da
  altri dispositivi/app non sono coordinate. Qobuz invariato.
- La creazione controlla il cooldown prima di segnare una scrittura come
  incerta e conserva l'anteprima se impedisce l'avvio. Dopo la creazione,
  in caso di errore mostra anche il numero di
  brani confermati; non ricrea la playlist e non reinvia blocchi falliti.
- Approfondimenti: [playlist e 429](https://github.com/orgs/tidal-music/discussions/155),
  [letture aggregate](https://github.com/tidal-music/discussions/discussions/185#discussioncomment-13471571).
  Esperienze della comunita', non quote ufficiali TIDAL.
- Modifica locale, non ancora pubblicata.

## PWA 1.15.2 · Richieste TIDAL e Qobuz

- Coda per servizio con almeno 500 ms fra chiamate; non e' una quota
  ufficiale garantita. Web Locks coordinano le schede dove disponibili.
- Pause HTTP 429 persistenti, Retry-After in secondi/data; 60 s prudenziali
  se manca o non e' leggibile. Nuove operazioni mostrano il tempo residuo.
- Solo letture: fino a 2 ritentativi, attese esponenziali e jitter per
  rete/429/5xx. Pause server oltre 30 s tornano all'interfaccia, senza
  reinviare richieste. Nessun retry automatico delle scritture.
- Attese interrotte da AbortSignal o cambio servizio/account; URL audio
  Qobuz inclusi nella stessa coda del catalogo. Nessun coordinamento
  fra dispositivi o con le app ufficiali dei servizi.
- Modifica locale, non ancora pubblicata.

## PWA 1.15.1 · Messaggi leggibili

- Finestre dei messaggi piu' ampie, altezza naturale e a capo conservati.
  Lo scorrimento e' limitato ai messaggi che superano lo schermo, senza
  un secondo riquadro scorrevole per il testo.
- Modifica locale, non ancora pubblicata.

## PWA 1.15.0 · Crea playlist condiviso

- Stesso builder e anteprima raggruppata per Spotify, TIDAL e Qobuz.
  Su TIDAL/Qobuz: cronologia Last.fm disponibile, artisti affini, album
  verificati nel catalogo scelto; nessuna richiesta Spotify.
- Obiettivo 1-50 artisti e 1-10 brani per artista; continuazione manuale
  con stato separato da Suggerimenti. Brani in ordine album, non classifiche
  native simulate. Duplicati e brani Qobuz non disponibili sono scartati.
  Filtro automatico Spotify/Discogs non equivalente disabilitato con tooltip.
- Qobuz e Spotify private; TIDAL UNLISTED (chi ha il link puo' accedere),
  con controllo Privata disabilitato e conferma esplicita.
- Creazione+aggiunta protette da Web Locks e indicatore persistente di
  esito incerto. Nessun reinvio: verifica nell'app e sblocca esplicitamente.
  La verifica non puo' cancellare la protezione di un'altra scheda in scrittura.
- Gestione TIDAL/Qobuz in pannelli secondari richiudibili. La gestione
  remota delle playlist esistenti non e' disponibile nella PWA Spotify:
  il controllo e' disabilitato con tooltip, senza aprire un'altra funzione.
- Cambiamenti locali, non pubblicati. Nuovo flusso verificato con dati
  sintetici, senza scritture negli account personali.

## PWA 1.12.10 · Crediti artisti TIDAL

- Nei suggerimenti TIDAL, le esclusioni per artista considerano anche i
  singoli crediti disponibili sugli album con piu' artisti, senza dividere
  i nomi che contengono virgole. Il catalogo resta non filtrato.

## PWA 1.12.9 · Riordino playlist Qobuz

- Leggi una playlist, seleziona fino a 100 occorrenze nella pagina e usa
  **Gestione playlist esistenti > Sposta all'inizio** o **Sposta in fondo**.
  Accord rilegge la pagina dopo la conferma e rifiuta modifiche se e'
  cambiata; un'altra app potrebbe comunque modificarla dopo il controllo.
- Il riordino e' stato provato tramite il client desktop con tre brani in
  playlist private temporanee, poi eliminate. La GUI PWA e' verificata con
  risposte sintetiche; non e' stata effettuata una scrittura dal browser.

## PWA 1.12.8 · Filtri per i suggerimenti

- In TIDAL e Qobuz, apri **Filtri suggerimenti** e inserisci i nomi esatti
  degli artisti separati da `;`. Salva e rileggi i suggerimenti. Il filtro
  e' locale e distinto per servizio; in TIDAL riguarda album e artisti
  mostrati, non i singoli brani dei mix. Non filtra generi o ascolti.

## PWA 1.12.7 · Playlist dai suggerimenti Qobuz

- In **Suggerimenti Qobuz** seleziona fino a dieci album e prepara una
  lista di brani. Si legge la prima pagina di ogni album, si mostrano
  fino a 250 brani distinti e si segnalano eventuali risultati parziali.
- Puoi elencare e scegliere la playlist di destinazione senza perdere
  la selezione. L'aggiunta richiede conferma ed e' limitata a 100 brani
  per operazione; non viene effettuata alcuna scrittura automatica.

## PWA 1.12.6 · Anteprima playlist TIDAL

- Seleziona fino a dieci album nei risultati TIDAL e premi **Prepara brani
  dagli album selezionati**. La PWA mostra fino a 250 brani distinti,
  segnalando pagine o metadati mancanti. La lettura non modifica TIDAL.
- In **Crea playlist**, carica e scegli la playlist di destinazione senza
  perdere i brani selezionati; prepara l'aggiunta e conferma separatamente
  l'invio. I duplicati gia' presenti vengono saltati. Disponibilita' e
  permessi dipendono dall'app e dall'account TIDAL.

## PWA 1.12.5 · Suggerimenti e coda locale Qobuz

- **Suggerimenti dai miei preferiti** legge la prima pagina dei preferiti e
  cerca album simili a un massimo di cinque album distinti. I preferiti
  letti sono esclusi dai risultati, che non rappresentano la cronologia.
- Seleziona uno o piu' brani nella pagina visualizzata e premi
  **Riproduci selezionati**. La coda locale mantiene l'ordine e le
  ripetizioni, passa al brano successivo e offre **Precedente**,
  **Successivo**, riproduzione casuale e ripetizione del brano o della
  selezione. Non modifica ne' legge la coda dell'app Qobuz.
- Se un'altra operazione blocca il passaggio automatico, attendi e riprendi
  o premi **Successivo**. Il cambio di servizio o la disconnessione fermano il
  player e svuotano la coda. La nuova coda non e' stata verificata con
  un account reale.

## PWA 1.12.4 · Interfaccia musicale semplificata

- I collegamenti Qobuz si trovano in **Preferenze e collegamenti**;
  ricerca, suggerimenti, playlist e player mostrano prima le azioni musicali.
  Link, ID, configurazione del player e dettagli tecnici restano disponibili
  nei rispettivi menu secondari.
- Scegli un album dal catalogo e usa **Usa per suggerimenti** o **Usa per
  playlist**. Per TIDAL la ricerca consente anche di scegliere un artista.
  Prima di modificare nome o descrizione di una playlist Qobuz, rileggila:
  se la descrizione non e' disponibile, inseriscila esplicitamente.
- La modifica reale di nome e descrizione e' stata verificata tramite il
  client desktop su una playlist temporanea, poi eliminata; non e' una
  verifica di scrittura end-to-end dalla GUI PWA.

## PWA 1.12.3 · Suggerimenti, playlist e player Qobuz

- Con Qobuz selezionato, **Suggerimenti** legge gli album simili a un
  album Qobuz. **Crea playlist** elenca playlist e brani a pagine,
  importa gli album selezionati nella raccolta locale e permette di
  creare playlist private o aggiungere e rimuovere occorrenze. Nome e
  descrizione sono modificabili; in quella versione il riordino non era disponibile.
- Le scritture richiedono conferma e Web Locks, senza reinvii automatici.
  Creazione, aggiunta, rimozione ed eliminazione sono state provate su una
  playlist temporanea; la successiva prova reale di nome/descrizione
  e' descritta sopra. Dopo esito incerto controlla Qobuz prima di
  sbloccare altre modifiche.
- Per il player, nel web player Qobuz apri F12 > Rete, ricarica e filtra
  `bundle.js`. Apri il solo script pubblico
  `play.qobuz.com/resources/.../bundle.js` e salvalo come `bundle.js`.
  In **Crea playlist > Configurazione player Qobuz**, caricalo, leggi una playlist o un
  album, seleziona i brani e premi **Riproduci selezionati**.
  Non caricare HAR, cookie o dati di accesso: il file e' letto sul
  dispositivo e non e' inviato a un backend. Le chiavi restano in memoria;
  se necessario selezionane un'altra.
- Il player richiede sessione e abbonamento Qobuz compatibili e supporto
  MP3; in questa versione riproduceva un brano alla volta a 320 kbps,
  senza coda o lossless.
  L'audio si interrompe cambiando servizio. L'API e il bundle sono non
  ufficiali e possono cambiare. La riproduzione integrata e' stata
  verificata con un account reale nella PWA locale. Questa versione
  rimane locale e non e' pubblicata.

## PWA 1.12.2 · Servizio musicale unificato

- Il selettore **Servizio musicale** include Spotify, TIDAL e Qobuz.
  **Aggiungi album** apre il catalogo del servizio selezionato; la raccolta
  locale rimane unica e i dati e gli accessi degli altri servizi restano invariati.
- In questa versione Qobuz non disponeva ancora di suggerimenti, playlist o
  player in Accord; le funzioni aggiunte successivamente sono descritte sopra.
  Per un album di un altro catalogo **Cerca in Qobuz** prepara la ricerca senza
  inventare un collegamento o avviare richieste automaticamente.

## PWA 1.12.1 · Raccolta Qobuz

- Il riquadro **Qobuz** nella raccolta consente ricerca, lettura paginata
  dei preferiti e importazione selettiva in Accord. Per cercare un album
  tramite ID o link usa **Leggi ID / link album**. Le modifiche dei
  preferiti remoti sono separate, richiedono conferma e non sono ritentate.
  Per serializzare le scritture fra schede serve Web Locks; se non disponibile
  usa il web player Qobuz. In caso di esito incerto verifica prima su Qobuz.
- L'accesso e' non ufficiale e puo' smettere di funzionare. Nel web player
  apri F12 > Rete, entra nella libreria e seleziona `favorite/getUserFavorites`;
  copia le intestazioni `X-App-Id` e `X-User-Auth-Token` in
  **Preferenze e collegamenti > Collegamento Qobuz**.
  Non inserire password ne' condividere token. L'accesso resta in
  `sessionStorage`, visibile agli script della stessa origine, e non entra in
  GitHub o backup; puo' scadere. Non e' previsto un backend.
- Le copertine Qobuz sono visibili online durante la sessione, ma non possono
  essere scaricate dalla PWA per l'offline perche' Qobuz non abilita CORS sulle
  immagini. Quelle sincronizzate dal desktop sono disponibili offline.
- Gli ID Qobuz restano distinti. Quando la raccolta sincronizzata li contiene,
  il formato passa alla versione 4: aggiorna prima tutti i client, poiche'
  quelli precedenti interrompono la sincronizzazione. Nessuna pubblicazione
  automatica della PWA, nessun widget o ora in ascolto Qobuz.

## Novita' PWA 1.12.0 · Musica segue il servizio scelto

- **Importa playlist TIDAL** nella raccolta: elenca le playlist salvate
  oppure incolla un link/ID, leggi l'anteprima e seleziona gli album da
  importare. I duplicati non sovrascrivono i dati locali; nessuna
  scrittura remota o sincronizzazione GitHub automatica.
- Apri album, aggiunta, link incollati/condivisi e pulsanti importazione
  seguono il selettore. Un album di un altro catalogo apre una ricerca
  nel servizio scelto, senza riciclare gli ID.
- Recupero manuale copertine dei soli album TIDAL visualizzati, massimo
  dieci per operazione con segnalazione del limite e cooldown comune.
- Suggerimenti TIDAL: mix e somiglianze ufficiali, non statistiche
  Spotify. La PWA non controlla il player Windows; Last.fm e i dati
  locali restano distinti. Nessuna modifica alle chiavi di storage.

## Correzione PWA 1.11.3 · Diagnostica account TIDAL

- TIDAL resta nelle stesse **Preferenze e collegamenti** di Spotify e
  Last.fm. Gli errori di collegamento vengono mostrati in questa finestra,
  non nella scheda musica sottostante.
- La guida spiega **Allowed scopes: None** e l'errore **1002** prima del
  login: il Client ID salvato localmente non concede permessi all'app.
  Abilitare nel portale TIDAL `user.read`, `search.read`, `collection.read`,
  `collection.write`, `playlists.read`, `playlists.write`, `recommendations.read`.
  Se non sono modificabili, rivolgersi al supporto TIDAL Developer.
  Restano invariati PKCE, redirect esatto, cooldown e nessun retry automatico.

## Correzione PWA 1.11.2 · Aggiunta manuale locale

- Anche l'aggiunta manuale da Spotify e l'abbinamento da Last.fm o
  MusicBrainz salvano solo sul dispositivo, come il desktop. Non avviano
  una sincronizzazione GitHub: usa **Sincronizza** quando desideri inviare
  le modifiche. Restano invariati sincronizzazione all'avvio, conflitti,
  dati locali e tutte le funzionalita' delle release precedenti.
- L'installazione di una nuova cache ricarica i soli file statici dalla
  rete, evitando di conservare una vecchia pagina dalla cache HTTP.
  L'attivazione resta esplicita da **Aggiorna ora**, senza cancellare
  raccolta, bozze o preferenze.
- La ricerca manuale parte da Last.fm, come indicato nel selettore e nel
  desktop; una bozza esistente mantiene invece la fonte gia' scelta.

## Correzione PWA 1.11.1 · TIDAL allineato a Spotify

- TIDAL usa le stesse gerarchie di schede, intestazioni, stati e comandi
  compatti della PWA Spotify. I risultati album mostrano copertina o
  segnaposto, titolo, artista, anno e selezione.
- La raccolta locale resta in primo piano e disponibile con entrambi i
  servizi. Ricerca e importazione TIDAL sono raccolte in un riquadro a
  espansione; configurazione account e accesso PKCE sono nelle impostazioni.
- I comandi meno frequenti sono dietro **Mostra altre azioni** e
  **Mostra gestione playlist esistenti**; il modulo playlist parte aperto e
  può essere richiuso.
- I filtri meno frequenti e le modifiche remote sono progressive; le
  anteprime, le conferme, le etichette UNLISTED e le protezioni di rete non
  cambiano. La ricerca rimane manuale, senza nuove richieste o polling.

## Novità PWA 1.11.0 · TIDAL senza backend

- **Servizio musicale**, sopra le schede, sceglie Spotify o TIDAL. La raccolta
  rimane unica; cambiare servizio non elimina token o preferenze Spotify.
  Con TIDAL sono bloccate anche le richieste Spotify già accodate e le risposte
  tardive, comprese ricerca e copertine automatiche. Un ID TIDAL non viene mai
  inviato a Spotify.
- Ricerca pubblica TIDAL di album, artisti, brani e playlist; album da link/ID,
  catalogo di un artista, lettura/importazione selettiva dei preferiti e degli
  album delle playlist. I preferiti remoti sono distinti da stato/voto locali.
  Aggiunta/rimozione preferiti, elenco/lettura/creazione/modifica/eliminazione
  playlist, aggiunta/rimozione/spostamento delle singole occorrenze dei brani:
  sempre anteprima e conferma esplicita, senza retry automatici delle scritture.
  Le playlist nuove sono **non in elenco (UNLISTED), non private**:
  accessibili a chi ha il link.
- Suggerimenti da album/artisti simili e mix ufficiali **Daily, Discovery,
  New Release**, quando disponibili per l'account. Sono fonti TIDAL,
  **non** classifiche o cronologia di ascolto. I mix possono contenere playlist:
  si leggono al massimo tre playlist, una pagina ciascuna. Ogni lettura è
  limitata a cinque pagine/250 risorse e dieci dettagli album aggiuntivi;
  troncamenti e metadati insufficienti sono dichiarati come risultati parziali.
- Nessun widget remoto, now playing, cronologia TIDAL, controllo del player,
  backend, client secret, API non ufficiale o servizio a pagamento/deployment.
  `PlaybackStates` e `RecommendationBlocks` sono INTERNAL e non vengono chiamati.
  Le copertine TIDAL già sincronizzate restano utilizzabili offline. Le letture
  esplicite possono mostrare gli artwork restituiti dall'API, solo da
  `https://resources.tidal.com` (dominio verificato negli esempi dell'SDK
  ufficiale). Nessuna ricostruzione di URL o ricerca Spotify. Le copertine
  appena importate sono online/in memoria, non dichiarate salvate offline.
- ID canonico `tidal:123`, link `https://tidal.com/browse/album/123`;
  campi/schema della raccolta, storage esistente, formato degli archivi
  copertine e backup restano compatibili. Nessuna conversione degli ID Spotify.
- Trasporto condiviso fra funzioni: deduplicazione delle letture concorrenti,
  cache per token rispettosa di `Cache-Control`, ETag, `Age`, `Date`,
  paginazione limitata allo stesso endpoint ufficiale, cooldown `429/Retry-After`
  persistente fra schede (Web Locks dove disponibile). Nessuna soglia numerica
  universale presunta.   Le impronte (non token o contenuti) delle scritture inviate/in corso/incerte
  restano sul dispositivo fra schede e riaperture, anche ricreando il trasporto:
  verificare lo stato remoto, non ripetere
  alla cieca una creazione o una modifica. Nessuna scrittura riparte dopo OAuth.

### Configurare la propria app TIDAL

1. Aprire [TIDAL Developer](https://developer.tidal.com/), registrare un'app
   personale e abilitare il flusso **Authorization Code con PKCE (S256)** per
   un client pubblico/browser. Non inserire mai un Client Secret in Accord.
2. Aprire Accord dalla sua destinazione effettiva HTTPS (oppure localhost).
   Aprire **Preferenze e collegamenti → TIDAL · accesso con PKCE**. Copiare
   l'URL esatto mostrato accanto a **Redirect URI**, incluse eventuali sottocartelle o
   `index.html`, e registrarlo nell'app TIDAL. Non aggiungere query o frammenti.
   La copia pubblicabile alla radice e quella sotto `/pwa/` possono avere URI
   diversi: registrare quello della pagina realmente utilizzata.
3. Abilitare gli scope pubblici `user.read`, `search.read`, `collection.read`,
   `collection.write`, `playlists.read`, `playlists.write`,
   `recommendations.read` fra quelli concessi all'app. Non richiedere
   `r_usr`/`w_usr`, riservati INTERNAL.
4. Incollare e salvare il **Client ID**, poi premere **Collega / autorizza TIDAL**.
   Il callback verifica state, destinazione e scadenza, separatamente da Spotify.
   Solo il Client ID resta persistente; token/verifier OAuth restano in
   `sessionStorage` e non vengono inclusi in raccolta, backup o GitHub.
   Dopo il ritorno scegliere una lettura: nessuna operazione remota viene
   eseguita automaticamente.

È necessaria una propria app approvata con le autorizzazioni richieste; senza
registrazione/credenziali reali il collegamento live non è verificabile.
Disponibilità, permessi, CORS e quote dipendono da TIDAL e dall'account.
Un rifiuto HTTP viene mostrato, senza ripiegare su endpoint non ufficiali.
Questa consegna **non pubblica** la PWA.

Riferimenti ufficiali verificati:
[OpenAPI TIDAL](https://tidal-music.github.io/tidal-api-reference/tidal-api-oas.json),
[autorizzazione](https://developer.tidal.com/documentation/api-sdk/api-sdk-authorization).
Test locali: `node --test accord-pwa-site\core.test.mjs accord-pwa-site\tidal.test.mjs accord-pwa-site\tidal-ui.test.mjs`
e gli stessi file in `accord\pwa`.

## Correzione PWA 1.10.1

- Rimossi integrazione Qobuz, selettore dedicato, backend privato e configurazione
  Render. Nessun servizio esterno viene richiesto. Le funzioni Spotify e i dati
  locali restano invariati.

## Novità PWA 1.9.0

- L'importazione playlist mantiene gli album completi e mostra singoli / EP
  separatamente, inizialmente deselezionati, così puoi scegliere ogni release
  prima di aggiungerla. Spotify identifica questi elementi come `single` senza
  distinguere con certezza EP e singoli. Anche la ricerca manuale Spotify li
  mostra e li aggiunge uno alla volta. Le scelte non vengono memorizzate nella
  cache snapshot e non generano richieste Spotify aggiuntive.

## Correzione PWA 1.7.2

- La copia servita da `/pwa/` usa riferimenti alle icone e al pre-cache
  relativi alla cartella degli asset superiore, evitando il fallimento
  dell'installazione offline per richieste a percorsi inesistenti.

## Novità PWA 1.6.0

- La ricerca nella raccolta parte solo quando premi Invio; digitare o
  modificare altri filtri non avvia ricerche intermedie.

## Novità PWA 1.5.0

- La ricerca nella raccolta attende una breve pausa di digitazione prima di
  aggiornare i risultati, evitando render ripetuti mentre scrivi.
- **Apri in Spotify** usa il collegamento nativo dell'album sul dispositivo;
  se Spotify è installato e associato, il sistema può avviarlo anche quando è
  chiuso. Non viene aperto il web player.

## Correzioni PWA 1.4.1

- I filtri non attivano piu' due render per la stessa scelta; le schede
  vengono inserite nel documento con un unico aggiornamento.
- Le letture Spotify concorrenti sono deduplicate e la cache rispetta
  `Cache-Control`, `Age`, `Date`, ETag e account. Senza indicazioni del
  server il fallback e' 30 minuti per le classifiche, 5 minuti per le altre
  letture ammesse; `no-store`, `no-cache` e scadenze esplicite prevalgono.
- Una scrittura playlist non elimina catalogo e classifiche validi.
  Importazioni ripetute riusano un riepilogo limitato in memoria solo con
  stesso account e snapshot verificato, con una nuova verifica finale.
  Una playlist cambiata durante la lettura interrompe l'importazione.
- Nessun polling aggiuntivo, aggiramento dei limiti o retry automatico
  delle scritture. Cooldown condiviso e `Retry-After` restano obbligatori.

## Novità PWA 1.4.0

- Nei dettagli, artista, generi, tag e collezioni sono pulsanti: applicano
  un filtro locale **esatto**, senza ricerche online. **Torna alla vista
  precedente** ripristina ricerca, filtri, ordinamento, layout, selezione
  e scorrimento. Il filtro esatto è incluso nelle viste salvate; filtro e
  percorso di ritorno restano nel riavvio richiesto da Aggiorna ora.
  La raccolta attuale non usa paginazione.
- La modifica multipla prepara un'anteprima con album realmente cambiati,
  invariati e tutti i valori prima/dopo. Solo **Conferma queste modifiche
  locali** scrive i dati; cambiare campi, selezione, raccolta o bozze
  richiede una nuova anteprima. Aggiungi/Rimuovi mantengono le operazioni
  incrementali; gli album con bozze interessate vanno prima risolti.
- **Vista e altro → Uniforma etichette locali** propone varianti come
  `Power Metal`/`power-metal` separatamente per generi, tag e collezioni.
  Scegli etichetta finale e album, poi verifica l'anteprima esatta e conferma.
  Nessuna fusione automatica; il genere principale mantiene il proprio ruolo.
- **Gestisci copertine offline** legge i byte effettivi dei file IndexedDB,
  anche per immagini non più associate a un album. Non è una stima dello
  spazio totale su disco: overhead, immagini solo online e icone della PWA
  non sono inclusi. Rimozione singola/totale con conferma; raccolta,
  preferenze, bozze, cronologia Last.fm e repository restano intatti.
  Una preferenza locale impedisce il download immediato delle immagini
  rimosse, anche dopo riapertura/sincronizzazione. Per riattivarle usa
  esplicitamente **Carica copertine mancanti online**; le miniature
  sincronizzate possono poi essere riscaricate con **Sincronizza**.
- Le schede mostrano **Bozza locale**; **Bozze locali** permette di
  riprendere senza ricerche automatiche o scartare con conferma. Le bozze
  di album rimossi sono visibili e scartabili, non applicate ad altri album.
- Importazione, anteprima/creazione playlist e sincronizzazione hanno
  guardie in memoria contro invii concorrenti, con feedback immediato.
  Un'anteprima playlist inviata viene consumata anche in caso di esito
  incerto: verifica prima Spotify, senza ripetizioni automatiche. Un errore
  di sincronizzazione annulla anche eventuali invii automatici accodati.
- Messaggi e **Attività** offrono copia della diagnostica oscurata e,
  quando pertinenti, collegamenti alle preferenze, bozze o copertine fallite.
  La copia contiene esclusivamente prodotto/versione, fase tecnica,
  codici HTTP di errore e conteggi aggregati di album, bozze e copertine
  fallite. Non include messaggi grezzi, nomi di album/artisti, URL,
  credenziali o contenuti personali. I messaggi visualizzati restano
  informativi, con token/chiavi noti e parametri sensibili oscurati:
  non copiarli manualmente come diagnostica.

Nessun nuovo endpoint, polling o traffico Spotify. Restano invariati cache
HTTP, budget e cooldown condiviso `429`/`Retry-After`, senza retry delle
scritture dall'esito incerto. Documentazione verificata:
[rate limit Spotify](https://developer.spotify.com/documentation/web-api/concepts/rate-limits).
Prove d'installazione e verifiche OAuth reali restano dipendenti dal browser
e dalla configurazione dell'app Spotify; i test locali non le simulano integralmente.

## Novità PWA 1.3.0

- Stato e voto modificabili direttamente sulle schede, anche da tastiera e
  su mobile. Se esiste una bozza dell'album, prima salvarla o scartarla nei
  dettagli: la modifica rapida non la sovrascrive.
- Precedente/Successivo nei dettagli seguono esclusivamente la vista
  filtrata e ordinata corrente, senza ricominciare dal primo album.
  Le bozze sono separate per album; un errore di salvataggio impedisce
  di cambiare album o chiudere l'editor.
- Incolla un link album Spotify nella raccolta. Gli album già presenti si
  aprono localmente; gli altri preparano Aggiungi album, senza richieste
  finché non premi **Cerca**. Le aggiunte usano la deduplicazione esistente.
  Il manifest espone un `share_target` GET: sui sistemi/browser compatibili,
  una condivisione apre l'album locale o prepara il link per una scelta
  esplicita. I parametri condivisi sono rimossi dalla barra degli indirizzi.
  L'avvio da condivisione non carica copertine online né avvia l'auto-sync.
- L'anteprima playlist mostra durata stimata, artisti unici, ripetizioni e
  proporzione di brani noti soltanto dai dati già disponibili. Dati mancanti
  o parziali sono dichiarati; gli album in raccolta non sono impropriamente
  considerati prove di ascolto dei singoli brani. Nessuna lettura aggiuntiva.
- **Vista e altro → Scarica backup locale JSON** esporta album e una lista
  chiusa di preferenze: layout, album fissati, dimensione testo, contrasto e
  densità. Nessuna credenziale, bozza, ricerca, cronologia, token o immagine.
  Gli URL album esportati sono canonici, senza parametri. Il file contiene
  comunque la tua raccolta personale: custodiscilo in un luogo privato.
  Il ripristino accetta backup locali di questo formato (massimo 10 MB):
  valida tutto prima dell'anteprima, richiede la selezione degli album e
  una conferma; le preferenze sono facoltative. Sostituisce per ID o aggiunge,
  non elimina gli album non selezionati. Album e preferenze sono salvati
  atomicamente in un'unica scrittura locale; un errore non cambia lo stato.
  Modifiche durante l'anteprima richiedono di riaprirla. Bozze preesistenti
  restano separate; il ripristino non equivale a una sincronizzazione.
  Le copertine già archiviate restano disponibili, ma non sono nel backup.
- **Attività** raccoglie lavoro in corso, messaggi/errori e scelte recenti
  solo in memoria (ultimi 30 eventi), con la scadenza del cooldown Spotify
  condiviso. Si aggiorna su eventi/apertura: niente polling o nuovi retry.
- Gli aggiornamenti pronti mostrano **Aggiorna ora / Più tardi**. Il worker
  non chiama `skipWaiting` all'installazione: l'attivazione richiede la scelta
  esplicita, senza bozze, finestre di modifica o attività in corso.
  Album locali già salvati, anche non sincronizzati, restano intatti.
  Scheda, filtri, selezione, posizione e anteprima playlist sono mantenuti
  nel riavvio richiesto; non parte un nuovo auto-sync/caricamento copertine.
  Un'altra finestra che attiva il worker non forza il riavvio di questa.
  **Più tardi** è reversibile da Attività. Il primo passaggio da una vecchia
  release priva di questo banner può richiedere la chiusura delle finestre
  precedenti secondo il normale ciclo del service worker.
- In **Preferenze → Accessibilità**, testo normale/115%/130%, contrasto alto
  e densità touch/compatta si applicano e persistono subito, senza dipendere
  dalla configurazione degli account. Il layout schede/elenco resta separato.

Non cambiano endpoint, budget, cache HTTP o gestione condivisa di
`Retry-After` Spotify. Condivisione installata e transizioni di aggiornamento
dipendono dal supporto del browser; la suite Node verifica i contratti
locali e del worker, non sostituisce una prova d'installazione su dispositivo.

La raccolta album, i suggerimenti e la creazione di playlist sono organizzati in tre schede.
La versione attiva è visibile nell'intestazione della PWA e nella barra del
titolo desktop. I due prodotti seguono cicli di rilascio indipendenti.

## Versionamento

Usiamo `MAJOR.MINOR.PATCH`: major per incompatibilita', minor per nuove
funzionalita' compatibili, patch per correzioni e ottimizzazioni. La versione
avanza una volta per insieme completo e verificato di modifiche, non a ogni
modifica intermedia. Le modifiche a un solo prodotto non incrementano l'altro.

La versione desktop risiede in `../app_version.py` e alimenta titolo e
diagnostica. Per la PWA, titolo e badge in `index.html` devono corrispondere
alla versione della cache in `sw.js`; un test ne verifica la coerenza.
I suffissi degli asset (`?v=...`) sono identificatori tecnici della cache,
non versioni del prodotto. Le versioni degli schemi e le chiavi dei dati
locali non cambiano con la release, evitando di perdere dati o preferenze.
La pubblicazione resta un'azione esplicita: preparare una versione non
significa che quella versione sia gia' online.

## Interfaccia e comandi locali

- **Vista e altro**: estrazione di un album locale per stato/genere,
  confronto delle possibili edizioni duplicate (senza fusioni), statistiche,
  viste salvate, differenze da sincronizzare e disponibilita' offline.
- Liste intelligenti per album ascoltati senza voto, piaciuti senza voto,
  modificati di recente o Da ascoltare fermi da 30 giorni. Le date sono
  registrate localmente da questa release, non ricostruite per gli album
  precedenti.
- I suggerimenti mostrano il motivo e i riferimenti effettivamente salvati.
  **Non adesso** li nasconde per 30 giorni sul dispositivo; i rinvii sono
  ripristinabili. Gli ultimi cinque risultati Spotify/Last.fm si riaprono
  dalla cronologia senza nuove ricerche.
- Bozze dei campi di ricerca manuale e dei dettagli album conservate dopo
  chiusura o riavvio; Salva/Aggiungi applicano, Scarta bozza elimina.
- Su mobile la barra della selezione resta in basso e apre la modifica
  multipla di stato, voto, generi, collezioni e tag. Solo i campi spuntati
  cambiano; gli elenchi supportano Aggiungi/Rimuovi/Sostituisci.
- La sincronizzazione mostra modifiche locali e ultimo successo. Prima
  delle scritture presenta invii/ricezioni/invariati; i conflitti affiancano
  soltanto i campi cambiati. L'importazione playlist richiede conferma
  dell'effetto locale prima del salvataggio.
- Lo stato offline verifica tutti i file della cache e conta le copertine
  archiviate. La rete rilevata non prova la disponibilita' dei servizi.
  Le nuove comodita' locali non generano richieste Spotify, Last.fm o GitHub.
  Bozze, viste, cronologia e rinvii non vengono sincronizzati.

- Tema scuro con un solo accento, focus da tastiera visibile e navigazione
  tra Raccolta, Suggerimenti e Crea playlist (anche con le frecce nelle schede).
- **Aggiungi album** è l'azione principale. **Vista e altro** raccoglie
  importazione playlist, caricamento esplicito delle copertine mancanti,
  vista comoda/compatta e filtro degli album fissati. I filtri musicali e
  l'ordinamento sono in un pannello espandibile separato dalla ricerca.
- Le schede mostrano copertina, titolo originale, artista, anno, stato e
  riepilogo dei metadati. **Fissa** aggiunge un indicatore separato:
  non modifica il titolo né l'ordine manuale. Vista e album fissati sono
  preferenze locali e non vengono sincronizzati.
- **Dettagli** apre una finestra modale accessibile, adattata a pannello
  inferiore sugli schermi stretti. Stato, voto, generi, collezioni e tag si
  salvano insieme con **Salva modifiche**; **Annulla** ed Esc scartano la
  bozza. Errori di validazione restano nella finestra, senza perdere i campi.
  Il collegamento ad ogni album Spotify resta disponibile sulla scheda.
- Le caselle sulle schede attivano una barra contestuale soltanto dopo la
  prima selezione: seleziona tutti gli album visibili, cambia stato, fissa,
  rimuovi il fissaggio o annulla la selezione. Gli album esclusi dai filtri
  vengono rimossi dalla selezione; cambiare sezione la azzera.
- **Cerca nella raccolta** filtra solo gli album locali. **Ctrl+K** (o
  **Cmd+K**) apre comandi e ricerca globale locale, anche da altre sezioni:
  cerca album/artisti, generi, collezioni e tag o passa a una sezione. Frecce,
  Invio ed Esc permettono l'uso senza mouse. La palette mostra fino a 30
  risultati; **Aggiungi album** apre invece la ricerca online, da avviare
  esplicitamente con **Cerca**. Nessun comando di navigazione sincronizza
  o avvia suggerimenti.
- Stati vuoti distinguono raccolta vuota e nessun risultato, con azione per
  aggiungere un album o azzerare tutti i filtri. Conferme di salvataggio
  discrete e preferenze raggruppate per GitHub, Last.fm e Spotify.

Ricerca locale, filtri, fissaggio, selezione, ordinamento, apertura dettagli
e cambio vista non avviano nuove ricerche di copertine o richieste API.
Le immagini già visualizzate vengono riutilizzate e le miniature IndexedDB
restano disponibili offline. Il caricamento online iniziale delle copertine
rimane; dopo un filtro puoi usare **Carica copertine mancanti online**.
I servizi musicali e la sincronizzazione conservano le code e i cooldown
esistenti. Questa PWA è il compagno album di Accord: non replica task,
posta o altre funzioni desktop.

Client statico per la raccolta album Accord. Questo repository pubblico deve
contenere solo il codice PWA, la documentazione pubblica e l'icona: mai
`albums.json`, dati personali, token o segreti. Il repository privato
`accord-music-data` resta separato.
La pagina e l'installazione mobile usano l'icona del gatto in PNG da 192 e
512 pixel, con percorsi relativi al sito GitHub Pages.

La raccolta mostra copertina, stato (Da ascoltare, In ascolto, Piaciuto, Neutro
o Non piaciuto), anno, genere principale, generi secondari,
voto, collezioni e tag. I filtri separano il genere principale dai
sottogeneri; scegliendo un principale, il secondo menu propone i relativi
generi secondari e l'opzione **Nessun sottogenere**.
Il menu dei generi secondari resta disabilitato con **Tutti i generi principali**,
**Senza genere principale** o quando il principale scelto non ha sottogeneri;
in questi casi l'eventuale filtro secondario viene azzerato.
Nei campi, il testo grigio e corsivo è un esempio e non viene salvato finché
non lo inserisci.
I documenti v1 e v2 restano compatibili: il primo genere della lista diventa
principale quando il record non ne specifica uno. La versione corrente
sincronizza il genere principale insieme agli altri campi della raccolta.
Le miniature JPEG sincronizzate sono conservate in `covers.bin` nel repository
privato, verificate con SHA-256 e salvate in IndexedDB per l'uso offline. Se
una miniatura manca, all'avvio o su richiesta esplicita la PWA prova a recuperarla dal singolo album Spotify e poi dal Cover Art
Archive; queste copertine online non vengono aggiunte al repository e per
averle offline serve sincronizzare Accord desktop. La
sincronizzazione album trasferisce solo i campi musicali previsti: non include
database, feedback o note di lavoro, task, token o configurazioni personali.
La cronologia Last.fm è un'esportazione distinta e facoltativa, inviata solo
quando l'utente preme **Esporta Last.fm** in Accord Desktop dopo la conferma.
Il file compresso contiene soltanto timestamp, artista, brano e album quando
disponibile; non contiene chiavi API né altri dati del database.
L'ordinamento automatico supporta artista, album, anno, voto, genere e
collezione. Il riordino manuale è locale al dispositivo PWA, si può fare con
le frecce o trascinando e non viene sincronizzato con GitHub.
Per caricare le miniature offline dopo un aggiornamento desktop, esegui una
sincronizzazione in Accord sul PC e poi sincronizza la PWA sul telefono.
La sezione Suggerimenti usa un selettore unico per scegliere Spotify o Last.fm,
con filtri artisti/genere espandibili e un pulsante esplicito di ricerca.
Spotify usa classifiche limitate a 50 artisti e 50 brani per periodi indicativi
di circa 1, 6 o 12 mesi, trova artisti tramite generi condivisi e propone i
loro album; la popolarità dei brani non è un voto dell'album. Last.fm usa
ascolti e intervalli scelti dall'utente; senza archivio sincronizzato considera
al massimo 1.000 ascolti per campione. Per la cronologia completa, importa
tutto lo storico Last.fm in Desktop, premi **Esporta Last.fm**, poi abilita
**Usa la cronologia Last.fm esportata da Accord Desktop** nelle impostazioni
della PWA e premi **Sincronizza**. L'archivio viene conservato offline in
IndexedDB; la PWA non lo scrive nel repository. Gli ascolti successivi
all'esportazione vengono letti direttamente da Last.fm; se superano 1.000,
la ricerca chiede di aggiornare l'esportazione desktop. Entrambi i flussi
possono espandere la ricerca fino a 30 artisti seed e 30 candidati.
MusicBrainz fornisce catalogo e generi; Discogs ordina le proposte quando trova
voti affidabili, con Last.fm come ripiego quando mancano. Non viene importata
la cronologia Spotify.

Le chiamate Last.fm sono distanziate di almeno un secondo; i risultati stabili
di catalogo sono memorizzati solo in memoria per sei ore, mentre la cronologia
personale non viene memorizzata nella cache delle risposte. Le richieste
Discogs usano l'API v2 e rispettano il limite anonimo prudenziale di 25
richieste al minuto, adattandosi ai limiti esposti dal servizio quando il
browser li rende leggibili. La PWA usa il normale User-Agent del browser e
non salva credenziali Discogs; i risultati dei suggerimenti Discogs hanno una
cache locale di 14 giorni.
Username e filtri restano nel profilo browser. La cronologia non viene inviata
dalla PWA; l'eventuale archivio esportato dal Desktop viene scaricato e salvato
solo dopo l'attivazione esplicita dell'opzione GitHub. Gli album aggiunti dalla raccolta o dai suggerimenti restano
locali fino a una sincronizzazione esplicita.
Dalla scheda Raccolta si
possono anche cercare album su Spotify per titolo, artista, ID o link e
aggiungerli singolarmente; la ricerca non avvia la sincronizzazione GitHub.
Le risposte Spotify rispettano gli header `Cache-Control`: `max-age`, ridotto
dall'età indicata da `Age` o `Date`, limita
la durata in memoria, gli ETag vengono rivalidati con `If-None-Match`/`304` e
`no-store` non viene conservato; player e contenuto playlist restano fuori
dalla cache. **Crea playlist** riusa lo stesso percorso di **Suggerimenti
Spotify**: prime cinque seed ammesse della classifica artisti, affinità tramite
generi, album nuovi dalla ricerca dei brani e scelta dell'album tramite Discogs.
Il periodo nella scheda playlist cambia solo la classifica di partenza;
esclusione degli ascolti, artisti e generi sono quelli della scheda
Suggerimenti Spotify. I brani vengono presi dal campione già letto dell'album
selezionato, verificando ID artista, ID album e URI del brano e ordinandoli
per popolarità disponibile. Nessun ripiego sugli artisti ascoltati né su Last.fm,
nessuna nuova ricerca per creare dalla stessa anteprima.
La presenza di album nella raccolta non esclude un artista dalla playlist,
nemmeno quando tutti i suoi album campionati sono già posseduti:
**Crea playlist** non applica l'esclusione degli album in raccolta.
**Suggerimenti Spotify** continua invece a nascondere gli album già posseduti.
Entrambi applicano gli album già campionati fra gli ascolti e le esclusioni
artisti impostate. Il percorso condiviso è quello Spotify, non quello dei
suggerimenti Last.fm; a parità di filtri i due risultati possono quindi
differire per questo filtro raccolta e per la dimensione del pool richiesta.
Le GET identiche in corso (anche fra suggerimenti e creazione playlist)
condividono una sola richiesta, con copie JSON indipendenti e separazione per
token; errori e risposte senza header di cache non vengono memorizzati.
Ogni tentativo di scrittura invalida cache e GET condivise al completamento,
anche se l'esito è incerto; una lettura precedente non ripopola la cache.
Anche i rinnovi concorrenti del token nella stessa scheda condividono una sola richiesta.
Le ricerche usano pagine da massimo 10 risultati. Per l'affinità si parte
da una pagina per ciascuno dei primi sei generi delle seed; se i candidati
non producono abbastanza album/brani compatibili, il medesimo percorso
legge le pagine successive, al massimo 50 risultati per genere. Non è
l'intero catalogo. La ricerca brani per artista mantiene un
campione fino a 50, fermandosi all'ultima pagina disponibile.
Ogni passaggio manuale di Suggerimenti Spotify o dell'anteprima ha due
contatori distinti, entrambi limitati a **40**: letture logiche (anche cache
hit) e tentativi HTTP effettivi (anche retry di rete, 429 o 5xx).
Non è una quota ufficiale Spotify; il cooldown condiviso resta obbligatorio.
L'anteprima richiede 1–50 artisti nuovi e 1–10 brani per artista (predefiniti
5 e 3), senza garantire quei numeri. Ogni gruppo di candidati usa la stessa graduatoria dei Suggerimenti
(generi condivisi, popolarità, nome), con gruppi da almeno dieci candidati
o dal numero richiesto fino a 50. I candidati senza album/brani compatibili
non consumano definitivamente il numero richiesto: si passa ai successivi
e, se necessario, alle pagine genere seguenti entro il budget.
Se budget o errore interrompono la lettura, gli artisti completati restano
nell'anteprima parziale: **Continua anteprima** avvia un altro passaggio
esplicito dalla prima ricerca artista incompleta (ripartendo dalla sua
prima pagina), oppure dalla pagina genere incompleta. Offset e fine delle
pagine genere, candidati deduplicati, artisti già processati e album
completati restano in memoria: non si rileggono classifiche o pagine genere
già completate. Una pagina fallita non viene avanzata. Cambiando impostazioni, account o
raccolta si riparte. Nessuna continuazione automatica e nessuna aggiunta di
artisti ascoltati per raggiungere il numero richiesto; a campione esaurito
può restare una playlist più corta, o nessun brano. La continuazione resta
solo in memoria e non sopravvive al ricaricamento.
Non vengono usati endpoint batch di lettura né endpoint top-tracks deprecati.
L'importazione legge pagine da 50 elementi e ricontrolla lo snapshot finale;
la creazione invia fino a 100 URI per scrittura, senza ritentare le POST.
La PWA non esegue polling del player: le letture partono dalle azioni utente
o dal caricamento delle copertine visibili.
Le richieste Spotify, inclusi scambio del codice OAuth e rinnovo del token,
passano dallo stesso trasporto e rispettano il cooldown `Retry-After`.
Le POST OAuth, come quelle delle playlist, non vengono ripetute automaticamente
in caso di 429, errore di rete o errore server: il loro esito può essere incerto.
Se Spotify segnala la quota dell'app esaurita, la PWA indica di controllare
uso e quota nella Developer Dashboard: non e' un permesso OAuth mancante.

### Riverifica Spotify PWA (28 ottobre 2026)

Inventario dei flussi reali; i conteggi sono tentativi iniziali, esclusi i
retry GET limitati e le risposte già disponibili in memoria:

| Flusso | Chiamate e contenimento |
| --- | --- |
| Autorizzazione e refresh | PKCE e redirect canonico; `POST accounts.spotify.com/api/token`, token in `sessionStorage`, refresh concorrenti riuniti nella scheda. Nessun replay automatico della POST. |
| Ricerca manuale, abbinamento Last.fm/MusicBrainz | Una `GET search` da 10 risultati oppure una `GET albums/{id}` per ID/link diretto. Copertina e selezione di un suggerimento riusano lo stesso abbinamento in memoria. |
| Album di un artista | Ricerca album fino a 50 risultati, massimo cinque pagine da 10, arresto quando la pagina è esaurita; nessuna ricerca alternativa illimitata. |
| Suggerimenti Spotify | Una classifica artisti e una brani, più eventuale classifica di esclusione diversa; fino a sei generi con massimo cinque pagine ciascuno, gruppi di dieci candidati e fino a cinque pagine brani per artista; refill se mancano album compatibili. Massimo 40 letture logiche e 40 tentativi HTTP per passaggio, compresi retry. Nessun caricamento automatico della cronologia completa, endpoint related-artists, recommendations o top-tracks rimosso. |
| Anteprima playlist | Stesso percorso candidati/album dei Suggerimenti, pool di 10–50 artisti; stessi limiti 40/40. I brani dell'album scelto riusano il campione verificato, senza ulteriori letture. Risultati parziali e continuazione manuale; anteprima riusata per la creazione. |
| Creazione playlist | `POST me/playlists`, poi `POST playlists/{id}/items` a blocchi di massimo 100 URI (massimo 500 brani). Fallimento interrompe i blocchi successivi; playlist parziale esplicitamente segnalata. Nessun retry automatico di scritture incerte. |
| Import playlist | Risoluzione ID/link o scansione nomi da 50, limite 2000 playlist; contenuti `/items` da 50, limite 10000 brani, verifica offset/totali/next e snapshot finale. Nessuna aggiunta locale se la lettura è incompleta o lo snapshot cambia. |
| Copertine raccolta e suggerimenti | Caricamento lazy delle schede visibili, code limitate, GET singolo album o ricerca già condivisa; fallback Cover Art Archive/MusicBrainz senza aggirare Spotify. Nessuna lettura batch rimossa. |
| Player, export e sync | Nessun polling/player Web API PWA. Export, persistenza e sincronizzazione GitHub della raccolta non chiamano Spotify; l'apertura dei link Spotify è una navigazione esplicita, non un fallback API. |

Il singleton della pagina serializza tutte le sue richieste Spotify. Il lock
`accord-spotify-api` serializza anche più schede e i percorsi radice/`pwa`
della **stessa origine** quando Web Locks è disponibile. Senza Web Locks resta
la coda per scheda e il cooldown in `localStorage`, ma non una mutua esclusione
atomica fra schede. Origini diverse, profili/dispositivi diversi e Desktop non
condividono questo storage; non esiste un coordinatore globale dell'app.
Prima di ogni tentativo HTTP, inclusi retry GET e POST OAuth/playlist, il
trasporto impone almeno **3 secondi fra gli inizi delle richieste**. L'istante
dell'ultimo invio è persistito in `accord-spotify-request-at-v1` sotto lo stesso
lock/coda, così anche una nuova scheda della stessa origine rispetta il passo.
Le risposte già in cache non attendono e non spostano l'istante. Il cooldown
`Retry-After` resta prioritario e non viene ridotto: anche un'attesa di
17240 secondi deve scadere prima di altre richieste. Se il cooldown viene
esteso durante l'attesa preventiva, viene ricontrollato prima dell'invio.
La pausa preventiva non ripete mai una scrittura dall'esito incerto.
Questo passo prudenziale non è una quota ufficiale né garantisce assenza di
429: Spotify considera tutto il traffico dell'app, anche da altri dispositivi.
Cache e deduplicazione delle GET sono per istanza/scheda e token, non globali.
I dati già visualizzati/abbinati sono snapshot dell'operazione, non una cache
persistente delle risposte HTTP. Il service worker intercetta solo la propria
origine, mai API o token Spotify.

Su 429 viene salvata la scadenza massima condivisa, senza cancellarla quando
scade: si evita che una scheda cancelli una scadenza appena estesa da un'altra.
`Retry-After` accetta secondi e data HTTP; se assente/non valido si usa un
backoff prudenziale di 5 secondi, **non** una soglia di quota. Le GET possono
attendere fino a 30 secondi e riprovare al massimo due volte per 429 e due per
errori transitori con backoff; prima di ogni tentativo ricontrollano lo storage.
Le POST durante il cooldown falliscono prima di inviare traffico.
Le richieste già in volo non possono essere ritirate retroattivamente.

L'audit ha corretto il bypass della coda/cooldown nelle due POST OAuth e la
durata eccessiva della cache quando la risposta aveva già un'età `Age`/`Date`.
I test riproducono questi casi con fetch, clock, attesa, storage e Web Locks
simulati, oltre ai casi preesistenti di cache, paginazione, deduplicazione e
scritture. Non richiedono account né richieste Spotify reali. Il workflow
Pages usa Node 22, controlla la sintassi dei moduli di entrambe le versioni e
da questa cartella esegue `node --test core.test.mjs pwa/core.test.mjs`.
Per la copia desktop `accord/pwa/`, esegui separatamente
`node --check app.mjs`, `node --check core.mjs`, `node --check ui.mjs`,
`node --check sw.js` e `node --test core.test.mjs` dalla sua cartella.

La [documentazione rate limit](https://developer.spotify.com/documentation/web-api/concepts/rate-limits)
descrive una finestra mobile di 30 secondi, ma **non pubblica una soglia
numerica universale**. Serializzazione e retry disciplinati non garantiscono
zero 429: conta il traffico complessivo dell'app.
Gli endpoint sono stati confrontati con il
[changelog febbraio 2026](https://developer.spotify.com/documentation/web-api/references/changes/february-2026);
nessun endpoint rimosso viene usato come aggiramento.

## Pubblicazione

Abilita GitHub Pages in **Settings → Pages**, scegliendo **GitHub Actions**
come sorgente. Il workflow pubblica i file statici a ogni push al branch
`main`. Dopo il deploy, apri `https://Melvin-91.github.io/accord-album-pwa/`.
Il workflow carica la radice e pubblica anche la sottocartella `pwa`.
Le due cartelle hanno versioni e percorsi relativi distinti: ciascuna suite
verifica i file accanto a sé. Il workflow le prova entrambe; non copiare test
da una cartella all'altra senza verificarne prima la compatibilità. La copia
desktop `accord/pwa/` non è inclusa nel workflow Pages e richiede il comando
locale documentato sopra.

## Primo uso sul telefono

1. Apri il sito HTTPS e installalo dal menu del browser (**Aggiungi alla
   schermata Home**).
2. Nelle impostazioni PWA inserisci il proprietario GitHub e un fine-grained
   token limitato al repository privato `accord-music-data`, con permesso
   Contents in lettura/scrittura.
3. Configura il Client ID Spotify e registra esattamente
   `https://melvin-91.github.io/accord-album-pwa/` come Redirect URI nell'app
   Spotify. Usa l'URL con la barra finale: resta uguale nel browser e nella
   PWA installata. L'autorizzazione usa PKCE; non inserire un client secret.
4. Il codice del sito è pubblico, ma la raccolta resta nel repository privato.
   I token vengono inseriti dall'utente sul dispositivo; quelli Spotify
   restano nella sessione del browser e non vengono pubblicati.

L'importazione playlist non avvia la sincronizzazione GitHub. Le modifiche
locali vengono inviate solo con una sincronizzazione manuale o se l'utente
abilita esplicitamente il sync all'avvio.

## Aggiunta manuale di un album

In **Raccolta album** scegli **Aggiungi album**. La ricerca predefinita usa
Last.fm (titolo, artista o genere/tag); inserisci una chiave API Last.fm nelle
impostazioni, conservata solo nel profilo browser e mai nella raccolta o su
GitHub. MusicBrainz permette di filtrare anche per anno; Spotify resta
disponibile con una singola richiesta standard per titolo, artista e anno.

I risultati Last.fm e MusicBrainz vengono abbinati a Spotify con una singola
ricerca: se esiste una sola corrispondenza verificata, l'album viene aggiunto
automaticamente alla raccolta; se i risultati sono ambigui, scegli l'edizione
corretta e premi **Aggiungi**. Questa corrispondenza
mantiene gli ID Spotify richiesti dalla sincronizzazione. I risultati Spotify
possono essere aggiunti direttamente; gli album già presenti non vengono
modificati. Le nuove voci avviano la sincronizzazione se GitHub è configurato,
altrimenti restano locali. I conflitti richiedono sempre una scelta esplicita.
Accord desktop offre lo stesso flusso e usa la chiave Last.fm già configurata
localmente; le chiavi non vengono trasferite tra dispositivi.

## Suggerimenti da ascolti Last.fm

Nella scheda **Suggerimenti**, inserisci il nome utente e scegli dal menu gli
ultimi 7, 30, 90 o 365 giorni, tutto lo storico oppure un intervallo di date
personalizzato. Senza archivio sincronizzato la PWA legge al massimo 1000
scrobble per campione (cinque pagine); se la cronologia è più ampia, indica che
il campione è parziale. Con l'archivio completo esportato da Desktop, usa tutti
gli ascolti fino alla copertura esportata e aggiunge quelli successivi da
Last.fm; se il delta supera 1000 ascolti, chiede di aggiornare l'esportazione.
Last.fm fornisce artisti affini e le classifiche dei loro
album più ascoltati; MusicBrainz fornisce catalogo e generi. Per ogni artista
confronta al massimo i due candidati più ascoltati da Last.fm e sceglie in base
al punteggio Discogs: media ponderata per il numero di voti e corretta verso
la media di 3,5 quando il campione è piccolo. L'aggregazione consulta le cinque
edizioni più diffuse, misurate dagli utenti Discogs che le possiedono; non sono
voti di utenti unici tra edizioni. Se l'abbinamento canonico o i voti non sono
disponibili, usa la classifica Last.fm. Ogni ricerca è limitata a 200 richieste
Discogs e i dati sono conservati nel browser per 14 giorni. Un errore su un
singolo album non interrompe la valutazione degli altri; il riepilogo distingue
i candidati esaminati, quelli senza master e quelli saltati per errore. La
ricerca parte da cinque artisti e si estende, se serve, fino a 30 seed e 30
artisti candidati; se non trova almeno dieci proposte, il riepilogo indica
quanti artisti sono stati esaminati e se la ricerca ha raggiunto il limite.
Filtri opzionali
includono/escludono artisti e generi; un filtro di inclusione richiede generi presenti nel catalogo.
Gli album già nella raccolta o già ascoltati nella cronologia consultata
(titolo e artista accreditato) vengono esclusi; se il campione Last.fm è
parziale, possono restare fuori ascolti più vecchi. Il catalogo MusicBrainz
viene consultato in gruppi di massimo dieci artisti, fino a tre pagine da 100
risultati per gruppo e a distanza di almeno 1,1 secondi; il conteggio aggregato e gli eventuali
campioni parziali sono mostrati. I risultati sono riutilizzati per 15 minuti
in una cache solo in memoria, limitata a otto query.
In caso di errori temporanei MusicBrainz (HTTP 429, 5xx o rete), la PWA riprova
fino a tre volte e poi usa le classifiche album Last.fm, mantenendo gli altri
filtri; il riepilogo segnala esplicitamente il ripiego. Senza MusicBrainz non
sono disponibili generi o anno, quindi i filtri che richiedono un genere
continuano a escludere album privi di generi verificabili.

Il limite di un album viene applicato a ogni artista accreditato, unificando le
varianti tramite MBID MusicBrainz e usando il nome come ripiego; fra i
candidati resta quello con il punteggio Discogs più alto, oppure quello più
ascoltato quando non ci sono voti Discogs sufficienti. Le diverse edizioni dello stesso album
restano selezionabili quando il catalogo non consente di distinguerle.
L'abbinamento usa l'MBID
Last.fm/MusicBrainz quando coincide, altrimenti artista e titolo esatti.
Le schede caricano su richiesta la copertina Spotify della corrispondenza più
coerente per titolo, artista e anno quando entrano nell'area visibile. Se
Spotify non è connesso o non emerge una corrispondenza affidabile, viene usata
Cover Art Archive come ripiego. Le copertine non vengono salvate nella
raccolta né sincronizzate.
Un MBID discordante, titoli omonimi con più gruppi o edizioni sono marcati
come ambigui: anche una singola corrispondenza
Spotify richiede conferma esplicita, mentre una corrispondenza non ambigua
può essere aggiunta automaticamente. Dopo aver abbinato album suggeriti, puoi
creare una playlist privata Spotify dai loro brani scegliendone il nome.
La playlist include fino a tre brani più popolari di ciascun album abbinato,
non album interi. La funzione richiede il permesso Spotify
`playlist-modify-private` e crea la playlist solo dopo aver verificato i brani.
La chiave API Last.fm, l'username e i filtri non vengono trasferiti a GitHub.
Gli ascolti vengono esportati soltanto con l'azione esplicita **Esporta Last.fm**
in Desktop; la PWA li legge e li conserva offline, ma non li scrive nel repository.
