# Push para o Azure DevOps

O PAT fica em `PAT_DEVOPS` no `.env` (não versionado). O comando lê o valor de lá e o envia via header, sem gravá-lo no remoto nem no histórico.

cd /home/adm_u133467/app/flowcraft && git add -A && git commit -m "feat: colaboração em tempo real, times, permissões e guias de alinhamento" && PAT=$(grep '^PAT_DEVOPS=' .env | cut -d= -f2-) && git -c http.extraHeader="Authorization: Basic $(printf ':%s' "$PAT" | base64 -w0)" push -u origin main

Requisitos: PAT com permissão **Code (Read & Write)** e remoto `origin` apontando para o repo `FlowCraft`.
