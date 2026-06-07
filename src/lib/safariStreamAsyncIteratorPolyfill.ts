// Polyfill : itération asynchrone des ReadableStream pour Safari / WebKit.
//
// WebKit (Safari, iPad/iPhone — toutes versions, y compris iOS 26) n'implémente
// PAS `ReadableStream.prototype[Symbol.asyncIterator]` / `.values()`. Chrome et
// Firefox l'implémentent.
//
// pdf.js v5 s'en sert sur le main thread dans `PDFPageProxy.getTextContent()` :
//   const readableStream = this.streamTextContent(params);
//   for await (const value of readableStream) { ... }   // pdf.mjs:15377
// Sans le polyfill, sur iPad : « undefined is not a function (…value of readableStream…) »
// au moment d'importer/parser un PDF (LTV, FT, manuel…). Le PC (Firefox/Chrome) marche.
//
// (Le worker pdf.js a aussi un `for await` sur un DecompressionStream, mais il est
// dans un try/catch avec repli sur le décodeur JS → auto-réparant, pas besoin de polyfill.)
//
// Polyfill minimal, idempotent, conforme au comportement attendu par pdf.js
// (lecture jusqu'à done ; libération du reader en fin/abandon).

function installReadableStreamAsyncIterator(): void {
  if (typeof ReadableStream === 'undefined') return
  const proto = ReadableStream.prototype as any
  if (typeof proto[Symbol.asyncIterator] === 'function') return // déjà natif

  function values(this: ReadableStream, options?: { preventCancel?: boolean }) {
    const preventCancel = Boolean(options?.preventCancel)
    const reader = this.getReader()
    return {
      async next() {
        try {
          const { done, value } = await reader.read()
          if (done) {
            reader.releaseLock()
            return { done: true, value: undefined }
          }
          return { done: false, value }
        } catch (err) {
          reader.releaseLock()
          throw err
        }
      },
      async return(value?: unknown) {
        if (!preventCancel) {
          const cancelPromise = reader.cancel(value)
          reader.releaseLock()
          await cancelPromise
        } else {
          reader.releaseLock()
        }
        return { done: true, value }
      },
      [Symbol.asyncIterator]() {
        return this
      },
    }
  }

  proto.values = values
  proto[Symbol.asyncIterator] = values
}

installReadableStreamAsyncIterator()

export {}
