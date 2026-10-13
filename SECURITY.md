# Segurança

O painel roda local, não abre servidor para fora e não envia nada para fora da máquina. O coletor só lê as telas
dos terminais (`maestri check`) e executa as CLIs instaladas (`claude`, `codex`, `agy`, `gh`) com comandos de
leitura de cota e de PRs. O botão de atualizar fala só com `127.0.0.1`.

Encontrou algo que exponha dados ou execute o que não devia? Abra uma issue marcada como "security"
descrevendo o caso, sem incluir saída real das CLIs (troque e-mails e caminhos por `<...>`).
