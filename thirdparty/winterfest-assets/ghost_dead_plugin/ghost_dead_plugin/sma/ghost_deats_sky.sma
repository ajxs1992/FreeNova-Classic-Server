#include <amxmodx>
#include <fakemeta>
#include <reapi>

enum _:eCvars
{
        Float: ENTITY_LIFETIME,
        Float: ENTITY_SPEED,
        Float: ENTITY_SPEED_ROTATE
}; new g_pCvar[eCvars];

new const PLUGIN_NAME[] = "[ReAPI] Ghost after death";
new const PLUGIN_VERSION[] = "0.0.2";

new const ENTITY_CLASSNAME[] = "ghost";
new const ENTITY_MODEL[] = "models/sp_sky_ghost_xmas_v1.mdl";

public plugin_init()
{
        register_plugin(PLUGIN_NAME, PLUGIN_VERSION, "steelzzz");

        RegisterHookChain(RG_CBasePlayer_Killed, "@CPlayer_Killed_Post", .post = true);
}

public plugin_cfg()
{
        bind_pcvar_float(create_cvar(
        .name = "gad_ent_life",
        .string = "2.5",
        .has_min = true,
        .min_val = 0.0
    ), g_pCvar[ENTITY_LIFETIME]);
        bind_pcvar_float(create_cvar(
            .name = "gad_ent_speed",
            .string = "135.0",
            .has_min = true,
    .min_val = 0.0
        ), g_pCvar[ENTITY_SPEED]);

        bind_pcvar_float(create_cvar(
            .name = "gad_ent_speed_rotate",
            .string = "165.0",
            .has_min = true,
            .min_val = 0.0
        ), g_pCvar[ENTITY_SPEED_ROTATE]);
}

public plugin_precache()
{
        engfunc(EngFunc_PrecacheModel, ENTITY_MODEL);
}

@CPlayer_Killed_Post(iVictim, iAttacker, iGib)
{
        if(!is_user_connected(iAttacker))
        {
                return;
        }

        new Float: vecOrigin[3];
        new Float: vecAVelocity[3];
        new Float: vecVelocity[3];

        vecVelocity[2] = g_pCvar[ENTITY_SPEED];
        vecAVelocity[1] = g_pCvar[ENTITY_SPEED_ROTATE];
        get_entvar(iVictim, var_origin, vecOrigin);

        new iEntity = rg_create_entity("info_target", false);

        if(is_nullent(iEntity))
        {
                return;
        }

        engfunc(EngFunc_SetModel, iEntity, ENTITY_MODEL);
        engfunc(EngFunc_SetSize, iEntity, {-10.0, -10.0, -10.0}, {10.0, 10.0, 10.0});
        engfunc(EngFunc_SetOrigin, iEntity, vecOrigin);

        set_entvar(iEntity, var_classname, ENTITY_CLASSNAME);
        set_entvar(iEntity, var_movetype, MOVETYPE_NOCLIP);
        set_entvar(iEntity, var_solid, SOLID_NOT);
        set_entvar(iEntity, var_velocity, vecVelocity);
        set_entvar(iEntity, var_avelocity, vecAVelocity);
        set_entvar(iEntity, var_nextthink, get_gametime() + g_pCvar[ENTITY_LIFETIME]);

        SetThink(iEntity, "@EGhost_Think");
}

@EGhost_Think(iEntity)
{
        set_entvar(iEntity, var_flags, FL_KILLME);
}