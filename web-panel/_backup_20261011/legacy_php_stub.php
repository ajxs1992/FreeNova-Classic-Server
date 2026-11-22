<?php
/**
 * Retired PHP MOTD. The live FreeNova hub is the Node panel on :8080.
 * GoldSrc MOTD uses /m/<code>/<steam>.htm — query-string SteamIDs return -102.
 */
header('Content-Type: text/html; charset=utf-8');
$base = 'http://192.168.1.3:8080';
$view = strtolower(isset($_GET['view']) ? $_GET['view'] : (isset($_GET['tab']) ? $_GET['tab'] : ''));
$sid = isset($_GET['steamid']) ? trim((string)$_GET['steamid']) : '';
$map = array(
  'player' => 'p', 'rankstats' => 'p', 'profile' => 'p', 'statsme' => 'p', 'rank' => 'p',
  'top' => 't', 'top15' => 't', 'leaderboard' => 't', 'rankings' => 't', 'mapend' => 't',
  'bp' => 'b', 'battlepass' => 'b', 'pass' => 'b',
  'missions' => 'i', 'tournament' => 'r', 'ctop' => 'r',
  'records' => 'a', 'achievements' => 'a', 'hof' => 'a',
  'store' => 's', 'shop' => 's', 'vip' => 'v', 'events' => 'e', 'models' => 'o'
);
  $code = isset($map[$view]) ? $map[$view] : 't';
  $short = '';
  if (preg_match('/^STEAM_(\d+):(\d+):(\d+)$/', $sid, $m))
    $short = $m[1] . '-' . $m[2] . '-' . $m[3];
  $url = $short !== ''
    ? ($base . '/m/' . $code . '/' . $short . '.htm')
    : ($base . '/top15?compact=1');
header('Location: ' . $url, true, 302);
$esc = htmlspecialchars($url, ENT_QUOTES, 'UTF-8');
echo "<!DOCTYPE html><html><head><meta charset='utf-8'><title>FreeNova</title></head>";
echo "<body bgcolor='#0D0F0E' text='#EDF1EF'><table width='100%' cellspacing='0' cellpadding='8' border='0'>";
echo "<tr><td><b><font color='#36DEAB'>FREENOVA PANEL MOVED</font></b><br>";
echo "<a href='{$esc}'><font color='#36DEAB'>Open the live hub</font></a></td></tr></table></body></html>";
