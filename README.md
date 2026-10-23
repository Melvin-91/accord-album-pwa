# Accord · Raccolta album PWA

La raccolta album e i suggerimenti sono organizzati in due schede separate.

Client statico per la raccolta album Accord. Questo repository pubblico deve
contenere solo il codice PWA, la documentazione pubblica e l'icona: mai
`albums.json`, dati personali, token o segreti. Il repository privato
`accord-music-data` resta separato.

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
La sezione Suggerimenti usa MusicBrainz e ListenBrainz per trovare artisti
affini a un artista della raccolta, senza inviare la cronologia personale.
L'esplorazione degli album richiede l'autorizzazione Spotify; gli album
vengono aggiunti localmente solo su scelta esplicita. Dalla scheda Raccolta si
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

In **Raccolta album** scegli **Cerca su Spotify** e inserisci titolo, artista,
ID o link Spotify. La funzione riutilizza il Client ID e l'autorizzazione
Spotify configurati per le playlist. I risultati vengono verificati e
deduplicati per ID; ogni album entra nella raccolta solo dopo aver premuto
**Aggiungi**. Gli album già presenti non vengono modificati. Le nuove voci
avviano subito la sincronizzazione con il repository privato se le credenziali
GitHub sono configurate; altrimenti restano locali, viene chiesto di
configurarle e la sincronizzazione parte dopo il salvataggio. I conflitti
richiedono sempre una scelta esplicita. Accord desktop offre la stessa ricerca
tramite l'icona a forma di lente nella riga della raccolta; se le credenziali
mancano, le richiede e avvia la sincronizzazione dopo il salvataggio. Le
copertine si aggiornano dopo che Accord desktop le carica nel repository
privato e la PWA sincronizza.
