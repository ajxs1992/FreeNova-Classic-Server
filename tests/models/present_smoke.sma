/**
 * tools/models - does the hand-built present actually load in the engine?
 *
 * This is a *scratch* proof plugin for the model pipeline, not a Winterfest
 * feature: it precaches the prop and puts one in the world, then reads back what
 * the engine made of it. If the .mdl were malformed, precache_model() is the call
 * that parses it, and ReHLDS would print a Mod_LoadModel / Host_Error line
 * instead of handing back a model index - so the absent-line assertions in
 * present_smoke.expect are the real result.
 *
 * Run it with the model already in the server tree:
 *   cp tools/models/present.{mdl,bmp} <build>/cstrike/models/winterfest/
 *   ./scripts/test-plugin.sh <this file>
 */
#include <amxmodx>
#include <amxmisc>
#include <cstrike>
#include <fakemeta>
#include <reapi>

#define PLUGIN  "Model present smoke test"
#define VERSION "1.0.0"
#define AUTHOR  "tools/models"

new const MODEL[] = "models/winterfest/present.mdl";

public plugin_precache()
{
	new idx = precache_model(MODEL);
	server_print("[MDLTEST] precache model=%s index=%d", MODEL, idx);
	if (idx <= 0)
		server_print("[MDLTEST] FAIL precache returned %d", idx);
}

public plugin_init()
{
	register_plugin(PLUGIN, VERSION, AUTHOR);
	server_print("[CS16TEST] init");
	set_task(1.0, "on_ready");
}

public on_ready()
{
	server_print("[CS16TEST] tick");

	// put the prop in the world at a fixed spot on de_dust2
	new ent = engfunc(EngFunc_CreateNamedEntity, engfunc(EngFunc_AllocString, "info_target"));
	if (!ent) {
		server_print("[MDLTEST] FAIL could not create an entity");
		return;
	}
	engfunc(EngFunc_SetModel, ent, MODEL);
	set_pev(ent, pev_movetype, MOVETYPE_NONE);
	set_pev(ent, pev_solid, SOLID_NOT);
	engfunc(EngFunc_SetOrigin, ent, Float:{0.0, 0.0, -100.0});

	// the engine's own answers, from the file it parsed:
	//   modelindex  - the model resolved out of the precache table
	//   frames      - the sequence table was read (our idle is exactly 1 frame)
	//   bone0       - the bone table was read (GetBonePosition needs a real bone)
	new midx = pev(ent, pev_modelindex);
	new frames = engfunc(EngFunc_ModelFrames, midx);
	new Float:borg[3], Float:bang[3];
	new bone = engfunc(EngFunc_GetBonePosition, ent, 0, borg, bang);

	server_print("[MDLTEST] spawned ent=%d modelindex=%d frames=%d bone0=%d",
		ent, midx, frames, bone);
	server_print("[MDLTEST] bone0_origin=%.2f,%.2f,%.2f", borg[0], borg[1], borg[2]);

	// and once more, straight from the file list the engine handed the client
	server_print("[MDLTEST] done rehlds=%d", is_rehlds());
}

/* Referenced only so AMXX must resolve a cstrike-module native at load time, the
 * same trick tests/smoke/smoke.sma uses: it keeps this run's module state
 * comparable to the base smoke test instead of loading a bare FakeMeta-only
 * stack. */
stock cstrike_probe(id)
{
	return cs_get_user_money(id);
}
