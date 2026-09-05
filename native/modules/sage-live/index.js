/* The Live Activity, from JavaScript. Absent on Android, on the simulator's
   older images, and on any iOS before 16.2, in which case every call here is a
   quiet no-op and `available` is false. */
import { requireOptionalNativeModule } from "expo-modules-core";

const Native = requireOptionalNativeModule("SageLive");

export const available = !!Native;

export async function enabled() {
  if (!Native) return false;
  try { return !!(await Native.enabled()); } catch (e) { return false; }
}

/** Start the line on the lock screen, or move the one already there. */
export async function start(attrs, state) {
  if (!Native) return null;
  try { return await Native.start(attrs || {}, state || {}); } catch (e) { return null; }
}

export async function update(state) {
  if (!Native) return false;
  try { return !!(await Native.update(state || {})); } catch (e) { return false; }
}

export async function end() {
  if (!Native) return false;
  try { return !!(await Native.end()); } catch (e) { return false; }
}

/** kind is "pts" (push-to-start, iOS 17.2+) or "activity" (a running one). */
export function addTokenListener(fn) {
  if (!Native) return { remove() {} };
  return Native.addListener("onToken", fn);
}

/** A button pressed on the Live Activity: { action } with one of
    lunch, away, back, take, pass, fly, to, done, ack. */
export function addActionListener(fn) {
  if (!Native) return { remove() {} };
  return Native.addListener("onAction", fn);
}

/** A press that happened while nobody was listening, once. */
export async function pendingAction() {
  if (!Native) return null;
  try { return (await Native.pendingAction()) || null; } catch (e) { return null; }
}
