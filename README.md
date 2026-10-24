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
3. Configura il Client ID Spotify e registra l'URL HTTPS del sito come
   Redirect URI esatto nell'app Spotify. L'autorizzazione usa PKCE; non
   inserire un client secret.
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

I risultati Last.fm e MusicBrainz non vengono aggiunti direttamente: scegli
**Abbina a Spotify** per verificare il record con una sola ricerca Spotify,
poi seleziona l'edizione corretta e premi **Aggiungi**. Questa corrispondenza
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
campione è parziale. Last.fm fornisce artisti affini e MusicBrainz i relativi
album, senza usare Spotify per la scoperta. Filtri opzionali includono/escludono
artisti e generi; un filtro di inclusione richiede generi presenti nel catalogo.
Gli album già nella raccolta o già presenti nello storico scaricato vengono
esclusi. Per aggiungere un risultato, Accord esegue una singola ricerca
Spotify e richiede una scelta esplicita dell'edizione. Chiave Last.fm,
username, filtri e ascolti non vengono trasferiti a GitHub.
