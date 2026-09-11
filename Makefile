PYTHON_BIN := .venv/bin/python

.PHONY: install test test-backend test-web typecheck build dev-api dev-web

install:
	python3 -m venv .venv
	$(PYTHON_BIN) -m pip install -r requirements.lock
	$(PYTHON_BIN) -m pip install --no-build-isolation --no-deps -e .
	npm --prefix web ci

test: test-backend test-web

test-backend:
	PYTHONPATH=src $(PYTHON_BIN) -m unittest discover -s tests -v

test-web:
	npm --prefix web test

typecheck:
	npm --prefix web run typecheck

build:
	npm --prefix web run build

dev-api:
	PYTHONPATH=src .venv/bin/uvicorn scully.api.app:app --reload --host 127.0.0.1 --port 8000

dev-web:
	npm --prefix web run dev
