FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /service
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libgomp1 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
# Install the CPU dependency set. No CUDA toolkit, NVIDIA runtime, or GPU
# provider is required: main.py explicitly uses ONNXRuntime CPUExecutionProvider.
RUN pip install --extra-index-url https://pypi.org/simple --prefer-binary -r requirements.txt
COPY main.py ./
RUN mkdir -p /data/faces /models

EXPOSE 8090
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8090"]
