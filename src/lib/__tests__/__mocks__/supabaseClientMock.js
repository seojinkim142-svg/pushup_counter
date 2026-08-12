// jest runs in plain Node with no WebSocket global, which supabase-js's
// realtime client needs at construction time — adventure.ts/routine.ts only
// need supabase.from()/auth.getUser() for their (untested, network-dependent)
// storage functions, so a real client isn't needed for the pure-logic tests
// that actually run here.
module.exports = { supabase: {} };
