#include <amxmodx>
#include <amxmisc>
#include <fakemeta>
#include <fakemeta_util>
#include <xs>

//#define DEBUG

// #define SET_PARENT(%0,%1)	set_pev(%0, pev_iuser1, %1)
// #define GET_PARENT(%0)		pev(%0, pev_iuser1)


new const TREE_MODEL[] = "models/green_tree3.mdl";
new const CLASSNAME_TREE[] = "env_tree";

#if defined DEBUG
new const LOG_FILE[] = "Christmas_TreeSpawn.log";
#endif

enum BodyGroups { 
	TREE = 1, 
	GARLANDS = 2, 
	TINSEL = 4
};

enum any: coord_e { Float:X, Float:Y, Float:Z }
enum any: Tree_Data_s
{
	Origin[coord_e]
	//, Float: Size
	//, szClassName[32]
}

const KEYSMENU = MENU_KEY_1|MENU_KEY_2|MENU_KEY_3|MENU_KEY_4|MENU_KEY_5|MENU_KEY_6|MENU_KEY_7|MENU_KEY_8|MENU_KEY_9|MENU_KEY_0


new Array: g_aTrees,
	g_iArraySize_Trees;

stock const g_szMainDir[] = "CristmasTrees";

const MAX_CONFIG_PATH_LEN = 128;

new g_szSpawnDirectory[MAX_CONFIG_PATH_LEN],
	g_szSpawnFile[MAX_CONFIG_PATH_LEN + 32],
	g_szMapName[32];

public plugin_precache() {
	precache_model(TREE_MODEL);

	g_aTrees = ArrayCreate(Tree_Data_s);

	if(GetPaths())
		ReadConfig(g_szSpawnFile);
}

public plugin_init() {
	register_plugin("Christmas Tree Spawn", "0.0.1b", "wopox1337");
	register_dictionary("Christmas_TreeSpawn.txt");

	register_clcmd("say /trees", "Show_TreesMenu");
	register_menu("Cristmas Trees Menu", KEYSMENU, "Tree_Handler");
}

public Show_TreesMenu(pPlayer)
{
#if !defined DEBUG
	if(!(get_user_flags(pPlayer) & ADMIN_BAN)) return PLUGIN_HANDLED;
#endif

	static szMenu[512], iLen;
	iLen = 0;

	iLen += formatex(szMenu[iLen], charsmax(szMenu) - iLen, "%L", pPlayer, "TR_TITLE", g_iArraySize_Trees);

	iLen += formatex(szMenu[iLen], charsmax(szMenu) - iLen, "%L", pPlayer, "TR_ADD");
	// iLen += formatex(szMenu[iLen], charsmax(szMenu) - iLen, "%L", pPlayer, "TR_DELETE");
	iLen += formatex(szMenu[iLen], charsmax(szMenu) - iLen, "%L", pPlayer, "TR_SAVE");
	iLen += formatex(szMenu[iLen], charsmax(szMenu) - iLen, "%L", pPlayer, "TR_DELETE_ALL");

	iLen += formatex(szMenu[iLen], charsmax(szMenu) - iLen, "%L", pPlayer, "TR_EXIT");
	
	show_menu(pPlayer, KEYSMENU, szMenu, -1, "Cristmas Trees Menu");
	
	return PLUGIN_HANDLED
}

public Tree_Handler(pPlayer, iKey)
{
	switch(++iKey)
	{
		case 1: UTIL_SpawnTree(pPlayer);
		// case 2: RemoveAimedTree(pPlayer);
		case 4:	{
			SaveTreesToFile(pPlayer);
			return;
		}
		case 5: RemoveAllTrees(pPlayer);
		case 10: return;
	}

	Show_TreesMenu(pPlayer);
}

stock RemoveAimedTree(pPlayer) {
	new iOrigin[3];
	get_user_origin(pPlayer, iOrigin, .mode = 3);
	new Float: fOrigin[3];
	IVecFVec(iOrigin, fOrigin);

	new pEnt = -1;
	while((pEnt = fm_find_ent_in_sphere(pEnt, fOrigin, 40.0))) {
		static szClassName[9];
		pev(pEnt, pev_classname, szClassName, charsmax(szClassName));

		if(equal(CLASSNAME_TREE, szClassName)) {
			// static pParent; pParent = GET_PARENT(pEnt);
			// if(pParent)	{
				// fm_remove_entity(pParent);
				fm_remove_entity(pEnt);
				

#if defined DEBUG
				// server_print("REMOVED: pEnt='%i', pParent='%i'", pEnt, pParent);
#endif
			// }
		}
	}
}

stock Spawn_Tree(iOrigin[3]) {

	for(new BodyGroups: i = TREE; i < BodyGroups; i++)
		CreateTree(iOrigin, i);

	ArrayPushArray(g_aTrees, iOrigin);
	g_iArraySize_Trees = ArraySize(g_aTrees);
}

stock CreateTree(iOrigin[3], BodyGroups: body) {
	new pEntity = fm_create_entity("info_target");

	if(!pEntity)
		return;

	new Float: fOrigin[3];
	IVecFVec(iOrigin, fOrigin);

	set_pev(pEntity, pev_classname, CLASSNAME_TREE);
	set_pev(pEntity, pev_movetype, MOVETYPE_NONE);
	
	set_pev(pEntity, pev_origin, fOrigin);
	set_pev(pEntity, pev_body, body);
	fm_entity_set_model(pEntity, TREE_MODEL);
	set_pev(pEntity, pev_solid, SOLID_BBOX);
	fm_entity_set_size(pEntity, Float:{ -47.12, -43.48, -61.65 }, Float:{ 48.86, 43.29, 211.15 });
	
	// static pParent;
	switch(body) {
		case GARLANDS: {
			fm_set_rendering(pEntity,
				.fx = kRenderFxGlowShell, //kRenderFxGlowShell,
				.r = random_num(0, 200), .g = random_num(0, 200), .b = random_num(0, 255),
				.render = kRenderGlow,
				.amount = 1
			);

			// SET_PARENT(pEntity, pParent);
		}
		case TINSEL: {
			fm_set_rendering(pEntity,
			.fx = kRenderFxGlowShell,
				.r = random_num(0, 200), .g = random_num(0, 200), .b = random_num(0, 255),
				.render = kRenderNormal,
				.amount = 2
			);

			// SET_PARENT(pEntity, pParent);
		}
		case TREE:
		{
			set_pev(pEntity, pev_effects, pev(pEntity, pev_effects) | EF_BRIGHTFIELD)
		}
		// default: pParent = pEntity;
	}
	
	fm_drop_to_floor(pEntity);

	// client_print(0, print_chat, "SPAWNED='%i'", pEntity);
}

ReadConfig(szFile[]) {
	new szTrees[2048], iLen;
	
	new pFile = fopen(szFile, "rt");
	if(pFile) {
		new any: TreeData[Tree_Data_s];
	
		new szBuffer[256],
			szOrigin[coord_e][6];

		while(!(feof(pFile))) {
			fgets(pFile, szBuffer, charsmax(szBuffer));
			trim(szBuffer);

			if(!(szBuffer[0]) || szBuffer[0] == ';')
				continue;

			parse(szBuffer,
				szOrigin[X], charsmax(szOrigin[]),
				szOrigin[Y], charsmax(szOrigin[]),
				szOrigin[Z], charsmax(szOrigin[])
			);
			
			for(new i; i < Tree_Data_s; i++) {
				TreeData[Origin][i] = str_to_num(szOrigin[i]);
			}

			#if defined DEBUG
			if(!iLen) {
				iLen += formatex(szTrees, charsmax(szTrees),
					"Tree Loaded from file '%s'", g_szSpawnFile
				);
			}
			
			iLen += formatex(szTrees[iLen], charsmax(szTrees) - iLen,
				"^n^t[#%i] T:[%i, %i, %i]",
				g_iArraySize_Trees + 1,
				TreeData[Origin][X], TreeData[Origin][Y], TreeData[Origin][Z]
			);
			#endif

			new Temp[3];
			Temp[X] = TreeData[Origin][X];
			Temp[Y] = TreeData[Origin][Y];
			Temp[Z] = TreeData[Origin][Z];
			
			Spawn_Tree(Temp);
			
			g_iArraySize_Trees = ArraySize(g_aTrees);
		}

		
		if(g_iArraySize_Trees) {
			iLen += formatex(szTrees[iLen], charsmax(szTrees) - iLen,
				"^n--- Loaded [%i trees] from File.", g_iArraySize_Trees
			);
		}
		else formatex(szTrees, charsmax(szTrees), "No trees data in file '%s'.", g_szSpawnFile);
		
		#if defined DEBUG
			log_to_file(LOG_FILE, szTrees);
		#endif
		fclose(pFile);
	}
	#if defined DEBUG
		else log_to_file(LOG_FILE, "Trees can't load from File '%s'.", g_szSpawnFile);
	#endif
}


stock SaveTreesToFile(pPlayer) {
	new aTreesData[Tree_Data_s],
		iTree,
		szBuffer[1024], iLen;

	if(!delete_file(g_szSpawnFile))
	{
		#if defined DEBUG
		log_to_file(LOG_FILE, "Can't delete file '%s'", g_szSpawnFile);
		#endif
	}

	if(!g_iArraySize_Trees) 
		return;

	new pFile = fopen(g_szSpawnFile, "wt");

	/* if(!g_iArraySize_Trees) {
		fputs(pFile, "");
		fclose(pFile);

		return;
	} */

	for(new i; i < g_iArraySize_Trees; i++) {
		ArrayGetArray(g_aTrees, iTree++, aTreesData);
#if defined DEBUG
		server_print("[#%i] X:%i Y:%i Z:%i",
			iTree,
			aTreesData[Origin][X],
			aTreesData[Origin][Y],
			aTreesData[Origin][Z]
		);
#endif
	
		iLen += formatex(szBuffer[iLen], charsmax(szBuffer) - iLen, "%i %i %i^n",
			aTreesData[Origin][X],
			aTreesData[Origin][Y],
			aTreesData[Origin][Z]
		);
	}

	
	if(pFile) {
		fputs(pFile, szBuffer);
	}

	fclose(pFile);
	

	client_print(pPlayer, print_chat, "%L", pPlayer, "TR_ALL_SAVED",
		g_iArraySize_Trees, g_szSpawnFile
	);
}


stock RemoveAllTrees(pPlayer) {
	if(g_aTrees) {
		ArrayClear(g_aTrees);
		g_iArraySize_Trees = 0;
	}

	if(!delete_file(g_szSpawnFile)) {
		#if defined DEBUG
		log_to_file(LOG_FILE, "Can't delete file '%s'", g_szSpawnFile);
		#endif
	}
	
	new pEnt = -1;
	while((pEnt = fm_find_ent_by_class(pEnt, CLASSNAME_TREE)))
		fm_remove_entity(pEnt);

	
	client_print(pPlayer, print_chat, "%L", pPlayer, "TR_ALL_REMOVED");
}



public UTIL_SpawnTree(pPlayer) {
	new iOrigin[3];
	get_user_origin(pPlayer, iOrigin, .mode = 3);

	Spawn_Tree(iOrigin);

	return PLUGIN_HANDLED;
}

bool: GetPaths()
{
	new iLen = get_localinfo("amxx_configsdir", g_szSpawnDirectory, charsmax(g_szSpawnDirectory));
	formatex(g_szSpawnDirectory[iLen], charsmax(g_szSpawnDirectory) - iLen,
		"%s/%s",
		g_szSpawnDirectory[iLen], g_szMainDir
	);
	
	#if defined DEBUG
	log_to_file(LOG_FILE, "Spawn directory='%s'", g_szSpawnDirectory);
	#endif
	
	MakeDir(g_szSpawnDirectory);

	get_mapname(g_szMapName, charsmax(g_szMapName))
	formatex(g_szSpawnFile, charsmax(g_szSpawnFile), "%s/%s.cfg", g_szSpawnDirectory, g_szMapName);
	
	#if defined DEBUG
	log_to_file(LOG_FILE, "Spawn file='%s'", g_szSpawnFile);
	#endif
	
	return file_exists(g_szSpawnFile) ? true : false;
}


stock MakeDir(const szDirName[], bool:bPrint = true)
{
	if(dir_exists(szDirName))
		return;

	if(bPrint)
		log_amx("Directory ^"%s^" not exist, will be created automatically.", szDirName);
	
	if(mkdir(szDirName) != 0)
	{
		log_amx("Failed to create directory ^"%s^"", szDirName);
		
		#if defined DEBUG
		log_to_file(LOG_FILE, "Failed to create directory ^"%s^"", szDirName);
		#endif
	}
}