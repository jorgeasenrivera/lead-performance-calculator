// Module-customization hook for test/room-command-handler.test.mjs (registered from that test). It redirects the ONE third-party import the room-command handler makes to an in-process stub; every other import is untouched.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@supabase/supabase-js') {
    return { url: new URL('./room-command-supabase-stub.mjs', import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
