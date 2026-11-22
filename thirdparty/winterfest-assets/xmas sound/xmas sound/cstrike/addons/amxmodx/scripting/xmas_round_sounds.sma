#include <amxmodx>

#define NUMAR_SUNETE_T 3
#define NUMAR_SUNETE_CT 3

new const Christmas_Sounds_T[NUMAR_SUNETE_T][] = {

//       "xmas/xmas_te1.mp3",
//       "xmas/xmas_te2.mp3",
         "xmas/xmas_te3.mp3",
         "xmas/xmas_te4.mp3",
         "xmas/xmas_te5.mp3"
}  

new const Christmas_Sounds_CT[NUMAR_SUNETE_CT][] = {
 
//       "xmas/xmas_ct1.mp3",
//       "xmas/xmas_ct2.mp3",
//       "xmas/xmas_ct3.mp3",
         "xmas/xmas_ct4.mp3",
         "xmas/xmas_ct5.mp3",
         "xmas/xmas_ct6.mp3"
}

public plugin_init() {

      register_plugin("[XMAS] RoundSounds","1.0","A k c 3 n 7");

      register_message( get_user_msgid( "SendAudio" ),"message_sendaudio" );

      register_event("SendAudio", "t_win", "a", "2&%!MRAD_terwin");

      register_event("SendAudio", "ct_win", "a", "2&%!MRAD_ctwin");
}

public t_win() {
  
      PlaySoundToClients (Christmas_Sounds_T[random(NUMAR_SUNETE_T)]);
}

public ct_win() {
 
      PlaySoundToClients (Christmas_Sounds_CT[random(NUMAR_SUNETE_CT)]);
}

public plugin_precache() {

      for(new i = 0; i < NUMAR_SUNETE_T; i ++)
      precache_sound(Christmas_Sounds_T[i]);

      for(new i = 0; i < NUMAR_SUNETE_CT; i ++)
      precache_sound(Christmas_Sounds_CT[i]); 
}

public message_sendaudio( msg_id, msg_dest, msg_entity ) {
    
        static message[10];
        get_msg_arg_string( 2, message, sizeof message - 1 );

        switch( message[7] )
        {
            case 'c', 't', 'r' : return PLUGIN_HANDLED;
        }

        return PLUGIN_CONTINUE;
   }   
  
PlaySoundToClients ( const sound [ ] ) {

        if ( equal ( sound [ strlen ( sound ) -4 ], ".mp3" ) )
                client_cmd ( 0, "mp3 play ^"sound/%s^"", sound );
        else
                client_cmd ( 0, "spk ^"%s^"", sound );
}