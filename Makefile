# ===== Румикуб: сборка, сохранение в архив, деплой на сервер =====
#
# Основной сценарий: build -> save -> deploy
#   make build        собрать docker-образ
#   make save         сохранить образ в архив rummikub.tar.gz
#   make deploy       залить архив на сервер, загрузить образ и запустить контейнер
#   make deploy-full  всё сразу (build + save + deploy)
#
# Переменные (переопределяются в командной строке или env):
#   make deploy SERVER=user@1.2.3.4 PORT=8080
#   make build IMAGE=myregistry/rummikub

IMAGE        ?= rummikub
ARCHIVE      ?= rummikub.tar.gz
CONTAINER    ?= rummikub
PORT         ?= 3001
VOLUME       ?= rummikub-data

# Удалённый сервер: user@host (обязательно указать при deploy).
# Ключ SSH должен быть настроен (ssh-key), на сервере установлен docker.
SERVER       ?= user@server.example.com
REMOTE_DIR   ?= /opt/rummikub
REMOTE_ARCH  ?= $(REMOTE_DIR)/$(ARCHIVE)

.PHONY: build save deploy deploy-full clean

# --- Сборка образа ---
build:
	docker build -t $(IMAGE) .

# --- Сохранение образа в архив ---
save: build
	docker save $(IMAGE) | gzip > $(ARCHIVE)
	@echo "Образ сохранён в $(ARCHIVE) ($(shell du -h $(ARCHIVE) | cut -f1))"

# --- Заливка архива на сервер, загрузка и запуск контейнера ---
deploy:
	@test -f $(ARCHIVE) || (echo "Нет архива $(ARCHIVE). Сначала: make save" && exit 1)
	ssh $(SERVER) "mkdir -p $(REMOTE_DIR)"
	scp $(ARCHIVE) $(SERVER):$(REMOTE_ARCH)
	ssh $(SERVER) "docker load -i $(REMOTE_ARCH)"
	ssh $(SERVER) "docker rm -f $(CONTAINER) 2>/dev/null; true"
	ssh $(SERVER) "docker run -d --name $(CONTAINER) --restart unless-stopped \
		-p $(PORT):$(PORT) \
		-e PORT=$(PORT) \
		-v $(VOLUME):/app/server/data \
		$(IMAGE)"
	@echo "Задеплоено. http://$(shell echo $(SERVER) | cut -d@ -f2):$(PORT)"

# --- Всё сразу ---
deploy-full: build save deploy

# --- Очистка ---
clean:
	rm -f $(ARCHIVE)
	docker rmi $(IMAGE) 2>/dev/null; true
