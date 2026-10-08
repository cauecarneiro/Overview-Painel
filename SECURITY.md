# Segurança

O quota-board roda local, escuta só em 127.0.0.1 e não envia nada para fora. Ele executa as CLIs
instaladas na máquina (`claude`, `codex`, `agy`) com comandos administrativos de cota.

Encontrou algo que exponha dados ou execute o que não devia? Abra uma issue marcada como
"security" descrevendo o caso, sem incluir saída real das CLIs (troque e-mails e caminhos por `<...>`).
