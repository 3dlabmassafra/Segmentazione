# Sezione — Studio di taglio 3D

Applicazione web in italiano per dividere modelli STL in sezioni più piccole. Interfaccia originale, ispirata alla categoria di strumenti di taglio multi-parte; non è una copia completa di Nativos Studio e non è affiliata al servizio.

## Avvio

Richiede Node.js 20.19+ o 22.12+ e npm.

```bash
npm ci
npm run dev
```

Apri l'indirizzo mostrato nel terminale. Per una build di produzione:

```bash
npm run build
npm run preview
```

Il risultato di `npm run build` è nella cartella `dist/`: pubblicala alla radice di un hosting statico. Nell'archivio consegnato trovi anche `sito-pronto/`, una build già compilata da caricare su un hosting statico. Servono HTTP/HTTPS e supporto ai Web Worker e WebAssembly: non aprire `index.html` con doppio clic usando `file://`.

Non sono necessari backend, database, account o chiavi API. Font, motore WASM e librerie sono serviti insieme al sito. L'applicazione non invia i file STL a server esterni. Non usa localStorage e non salva automaticamente il progetto: scarica le parti prima di chiudere o ricaricare la scheda.

## Funzioni implementate

- Importazione STL binario e ASCII con trascinamento o selezione file.
- Controllo di validità del solido con Manifold WASM e saldatura dei vertici coincidenti tramite `Mesh.merge()`.
- Limiti: 30 MB e 500.000 triangoli per file. La memoria disponibile dipende dal dispositivo.
- Modello dimostrativo parametrico di un vaso a coste, generato localmente.
- Fino a 5 piani paralleli sull'asse X, Y o Z (fino a 6 sezioni).
- Posizione dei piani tramite slider o campo numerico, relativa al limite inferiore del modello sull'asse selezionato.
- Tagli geometrici reali con chiusura delle superfici, calcolati in un Web Worker per non bloccare l'interfaccia.
- Rotazione, zoom, selezione delle parti, wireframe, griglia, vista dall'alto e vista esplosa.
- Anteprime delle singole parti, dimensioni e conteggio triangoli.
- Download STL binario individuale o archivio ZIP con tutti gli STL e istruzioni.
- Layout adattabile per desktop, tablet e smartphone; guida integrata.

## Flusso d'uso

1. Il sito apre un vaso dimostrativo già diviso in tre parti.
2. Importa il tuo STL: la mesh viene centrata in X/Y e appoggiata a Z = 0. Per cominciare vengono applicati due tagli uniformi lungo Z.
3. Scegli l'asse, aggiungi/rimuovi i piani e imposta le posizioni.
4. Premi **Applica tagli**. Gli export sono disattivati finché i piani modificati non sono stati applicati.
5. Usa **Esporta tutte le parti** o l'icona di download su una singola parte.

Scorciatoie: `R` centra il modello, `W` attiva/disattiva il wireframe, `Invio` applica i tagli modificati quando il focus non è su un campo o un pulsante, `Ctrl/Cmd + O` apre un STL.

## Limiti e note per la stampa

- Questa versione non genera incastri, spine, tolleranze o connettori automatici.
- Non supporta piani obliqui, assi misti nello stesso passaggio, importazione OBJ/3MF o salvataggio di un progetto modificabile.
- I file STL non contengono unità: tutte le coordinate sono interpretate come millimetri.
- Sono richieste mesh chiuse e correttamente orientate. La saldatura dei vertici non ripara automaticamente buchi, auto-intersezioni o geometrie arbitrarie. Verifica sempre anche nel tuo slicer.
- Una sezione può contenere più componenti scollegate. Un piano in un vuoto non produce una parte vuota esportabile: il numero di parti può essere inferiore a quello teorico.
- Le parti esportate sono centrate separatamente in X/Y e appoggiate a Z = 0, senza rotazione automatica. La vista esplosa è solo visiva.
- «Solido chiuso» non significa che la parte si possa stampare senza supporti o ulteriori verifiche. Controlla volume di stampa, spessori, scala, orientamento e supporti nel tuo slicer.
- Il modello demo ha una parete di circa 3 mm. La stampabilità delle nervature dipende dalle impostazioni della stampante.

## Tecnologie

- Three.js per visualizzazione 3D, import ed export STL.
- Manifold 3D / WebAssembly per solidi e tagli topologici.
- Web Worker per l'elaborazione geometrica.
- fflate per esportazione ZIP.
- Lucide per le icone, DM Sans e Manrope per i font locali.
- Vite per sviluppo e build.

## Verifiche

```bash
npx playwright install --with-deps chromium
# Con il dev server avviato sulla porta 5173:
node tests/functional.mjs
```

Il test controlla l'esportazione del demo, l'importazione di un cubo, tagli su tutti e tre gli assi, validità manifold degli STL riesportati, conservazione del volume, aggiunta/rimozione piani, rifiuto di un file non valido senza perdere il modello precedente, download ZIP, comandi di visualizzazione e assenza di overflow orizzontale su mobile.

I test automatici non sostituiscono una validazione completa su qualsiasi mesh. I file dei test generati e gli screenshot non sono necessari per pubblicare il sito.

## Pubblicazione su GitHub Pages

Repository: https://github.com/3dlabmassafra/Segmentazione

URL previsto dopo il deploy: https://3dlabmassafra.github.io/Segmentazione/

Il workflow `.github/workflows/deploy-pages.yml` compila e pubblica automaticamente a ogni push sul branch `main`. Nel repository, **Settings → Pages → Build and deployment → Source** deve essere impostato su **GitHub Actions**.

Il workflow imposta `VITE_BASE_PATH=/Segmentazione/`, necessario per caricare correttamente script, font, worker e WASM sotto il percorso del repository. Per testare localmente la stessa configurazione:

```bash
VITE_BASE_PATH=/Segmentazione/ npm run build
npm run preview
```

Se cambi nome al repository, aggiorna `VITE_BASE_PATH` nel workflow. Non inserire mai password o token nel codice o nei file versionati.
