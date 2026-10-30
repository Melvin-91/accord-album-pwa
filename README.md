# Accord · Raccolta album PWA

La raccolta album, i suggerimenti e la creazione di playlist sono organizzati in tre schede.
La versione attiva dell'app è visibile nell'intestazione della PWA e nella
barra del titolo dell'app desktop; la build iniziale è `1.0.0`.

## Interfaccia e comandi locali

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

La raccolta mostra copertina, stato (Da ascoltare, In ascolto, Mi piace o Non
mi piace), anno, genere principale, generi secondari,
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
dalla cache. La playlist per artista usa la ricerca e
ordina i risultati disponibili per popolarità, senza replicare la classifica
completa dell'endpoint deprecato.
Le GET identiche in corso (anche fra suggerimenti e creazione playlist)
condividono una sola richiesta, con copie JSON indipendenti e separazione per
token; errori e risposte senza header di cache non vengono memorizzati.
Ogni tentativo di scrittura invalida cache e GET condivise al completamento,
anche se l'esito è incerto; una lettura precedente non ripopola la cache.
Anche i rinnovi concorrenti del token nella stessa scheda condividono una sola richiesta.
Le ricerche usano pagine da massimo 10 risultati, mantenendo il campione
complessivo richiesto fino a 50 e fermandosi all'ultima pagina disponibile.
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
| Suggerimenti Spotify | Una classifica artisti e una brani, più eventuale classifica di esclusione diversa; fino a sei ricerche genere e dieci artisti, ciascuna fino a cinque pagine. Nessun caricamento automatico della cronologia completa, endpoint related-artists, recommendations o top-tracks rimosso. I risultati possono essere limitati o vuoti se Spotify omette generi/popolarità. |
| Anteprima playlist | Una classifica di 1–20 artisti e fino a cinque pagine di ricerca brani per artista; anteprima riusata per la creazione, non ricalcolata. |
| Creazione playlist | `POST me/playlists`, poi `POST playlists/{id}/items` a blocchi di massimo 100 URI (massimo 200 brani). Fallimento interrompe i blocchi successivi; playlist parziale esplicitamente segnalata. Nessun retry automatico di scritture incerte. |
| Import playlist | Risoluzione ID/link o scansione nomi da 50, limite 2000 playlist; contenuti `/items` da 50, limite 5000 brani, verifica offset/totali/next e snapshot finale. Nessuna aggiunta locale se la lettura è incompleta o lo snapshot cambia. |
| Copertine raccolta e suggerimenti | Caricamento lazy delle schede visibili, code limitate, GET singolo album o ricerca già condivisa; fallback Cover Art Archive/MusicBrainz senza aggirare Spotify. Nessuna lettura batch rimossa. |
| Player, export e sync | Nessun polling/player Web API PWA. Export, persistenza e sincronizzazione GitHub della raccolta non chiamano Spotify; l'apertura dei link Spotify è una navigazione esplicita, non un fallback API. |

Il singleton della pagina serializza tutte le sue richieste Spotify. Il lock
`accord-spotify-api` serializza anche più schede e i percorsi radice/`pwa`
della **stessa origine** quando Web Locks è disponibile. Senza Web Locks resta
la coda per scheda e il cooldown in `localStorage`, ma non una mutua esclusione
atomica fra schede. Origini diverse, profili/dispositivi diversi e Desktop non
condividono questo storage; non esiste un coordinatore globale dell'app.
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
scritture. Non richiedono account né richieste Spotify reali:
`node --check app.mjs`, `node --check core.mjs`, `node --check sw.js`,
`node --test core.test.mjs`.

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
Il workflow del repository pubblico carica la sua radice: le copie dei file
PWA nella radice e nella sottocartella `pwa` devono restare allineate,
preservando i differenti percorsi relativi delle icone.
Prima della pubblicazione esegui `node --check app.mjs`,
`node --check core.mjs` e `node --test core.test.mjs` dalla cartella PWA;
i test verificano anche il numero di richieste concorrenti, pagine e batch.

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
