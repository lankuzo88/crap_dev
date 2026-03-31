$action = New-ScheduledTaskAction -Execute "C:\Users\Administrator\Desktop\crap_dev\sync_gdrive.bat"
$trigger = New-ScheduledTaskTrigger -Once -At "00:00" -RepetitionInterval (New-TimeSpan -Minutes 30) -RepetitionDuration (New-TimeSpan -Days 1)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "SyncDataToGoogleDrive" -Action $action -Trigger $trigger -Settings $settings -Force
