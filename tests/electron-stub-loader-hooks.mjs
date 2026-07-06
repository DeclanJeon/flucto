export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return {
      shortCircuit: true,
      url: new URL('./electron-stub.mjs', import.meta.url).href,
    };
  }

  return nextResolve(specifier, context);
}
