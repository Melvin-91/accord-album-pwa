# Accord · Raccolta album PWA

La raccolta album e i suggerimenti sono organizzati in due schede separate.

Client statico per la raccolta album Accord. Questo repository pubblico deve
contenere solo il codice PWA, la documentazione pubblica e l'icona: mai
`albums.json`, dati personali, token o segreti. Il repository privato
`accord-music-data` resta separato.
La pagina e l'installazione mobile usano l'icona del gatto in PNG da 192 e
512 pixel, con percorsi relativi al sito GitHub Pages.

La raccolta mostra copertina, stato, anno, generi, voto, collezioni e tag.
I record v1 sono compatibili e vengono migrati al successivo aggiornamento.
Le miniature JPEG sono conservate in `covers.bin` nel repository privato,
verificate con SHA-256 e salvate in IndexedDB per l'uso offline. La
sincronizzazione trasferisce solo i campi musicali previsti: non include
database, feedback o note di lavoro, task, token o configurazioni personali.
L'ordinamento automatico supporta artista, album, anno, voto, genere e
collezione. Il riordino manuale è locale al dispositivo PWA, si può fare con
le frecce o trascinando e non viene sincronizzato con GitHub.
Per caricare le miniature dopo un aggiornamento desktop, esegui una
sincronizzazione in Accord sul PC e poi sincronizza la PWA sul telefono.
La sezione Suggerimenti permette di esplorare artisti affini con ListenBrainz
oppure, su richiesta, di usare Last.fm per derivare artisti di partenza dagli
ascolti e MusicBrainz per il catalogo. Username e filtri restano nel profilo
browser; la cronologia non viene salvata o sincronizzata. I risultati vengono
abbinati a Spotify con una singola ricerca solo dopo la scelta dell'utente.
Dalla scheda Raccolta si
possono anche cercare album su Spotify per titolo, artista, ID o link e
aggiungerli singolarmente; la ricerca non avvia la sincronizzazione GitHub.

## Pubblicazione

Abilita GitHub Pages in **Settings → Pages**, scegliendo **GitHub Actions**
come sorgente. Il workflow pubblica i file statici a ogni push al branch
`main`. Dopo il deploy, apri `https://Melvin-91.github.io/accord-album-pwa/`.

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

Nella scheda **Suggerimenti**, inserisci il nome utente e scegli un intervallo
da 1 a 3650 giorni. La PWA legge al massimo 1000 scrobble per richiesta
(cinque pagine); se la cronologia è più ampia, il risultato indica che il
campione è parziale. Last.fm fornisce artisti affini e le classifiche dei loro
album più ascoltati; MusicBrainz fornisce catalogo e generi. Vengono proposti
al massimo tre album più ascoltati per artista. Filtri opzionali
includono/escludono artisti e generi; un filtro di inclusione richiede generi presenti nel catalogo.
Gli album già nella raccolta o già presenti nello storico scaricato vengono
esclusi. Il catalogo MusicBrainz viene consultato in massimo tre pagine da
100 risultati, a distanza di almeno 1,1 secondi; il conteggio e gli eventuali
campioni parziali sono mostrati. I risultati sono riutilizzati per 15 minuti
in una cache solo in memoria, limitata a otto query.

Il limite massimo di tre album viene applicato a ogni artista accreditato,
unificando le varianti tramite MBID MusicBrainz e usando il nome come ripiego;
fra i candidati restano i più ascoltati. L'abbinamento usa l'MBID
Last.fm/MusicBrainz quando coincide, altrimenti artista e titolo esatti.
Le copertine dei suggerimenti vengono caricate su richiesta da Cover Art
Archive quando le schede entrano nell'area visibile; non vengono salvate nella
raccolta né sincronizzate.
Un MBID discordante, titoli omonimi con più gruppi o edizioni sono marcati
come ambigui: anche una singola corrispondenza
Spotify richiede conferma esplicita, mentre una corrispondenza non ambigua
può essere aggiunta automaticamente. Dopo aver abbinato album suggeriti, puoi
creare una playlist privata Spotify dai loro brani scegliendone il nome.
La funzione richiede il permesso Spotify `playlist-modify-private`, crea la
playlist solo dopo aver verificato i brani e aggiunge al massimo 1000 brani.
Chiave Last.fm,
username, filtri e ascolti non vengono trasferiti a GitHub.
