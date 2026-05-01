---
title: 'Why We Rewrote the Agent Long-term Memory System in Rust'
description: 'This post shares our journey of rewriting EverMemOS from Python to Rust and how we provide native support for the multi-language ecosystem through "Memory as Infrastructure."'
pubDate: 'Mar 19 2026'
heroImage: '../../assets/evermemos-rs-rewrite-banner.png'
---

> **Summary**: In today's explosion of AI Agents, memory systems are often viewed as just Python scripts. However, when building production-grade Agents that require high concurrency and low latency, Python's performance bottlenecks become evident. This post shares our journey of rewriting EverMemOS from Python to Rust and how we provide native support for the multi-language ecosystem through "Memory as Infrastructure."

---

## 1. Status Quo: "Memory" Trapped in Python

Currently, the vast majority of Agent frameworks (such as LangChain, CrewAI) and memory components are implemented purely in Python. While Python is excellent for prototyping and AI experimentation, issues arise when we shift our focus to **production-grade infrastructure**:

- **Concurrency Bottlenecks**: Python's GIL limits multi-threaded capabilities for large-scale reranking and retrieval.
- **Cold Starts and Memory Footprint**: Python's runtime bloat is unfriendly to edge computing or lightweight deployments.
- **Memory as Script vs. Memory as Service**: Memory should not be just a `json` file or a simple `chromadb` wrapper; it should exist as high-performance, highly reliable **infrastructure (Infra)**, similar to Redis or PostgreSQL.

## 2. Transformation: The "Hardcore" Logic Behind the Rust Rewrite

We decided to perform a low-level rewrite of EverMemOS using **Rust** (resulting in `evermemos-rs`), primarily based on the following three dimensions:

### 🚀 Extreme Performance
By leveraging Rust's asynchronous runtime (Tokio) and zero-cost abstractions, we reduced the end-to-end latency of memory extraction and retrieval by approximately **60%**. Rust's performance is truly stunning when handling complex Hybrid Search (Vector + Full-text + RRF).

### 🛠️ Memory as Infrastructure (Memory as Infra)
We redefined the memory system as underlying infrastructure:
- **Storage Layer**: Switched to **SurrealDB**, utilizing its native support for graph queries and vector indexing.
- **Communication Protocol**: In addition to REST APIs, we provide native support for **MCP (Model Context Protocol)**, allowing Agents to invoke memory just like system commands.

### 🧩 True Multi-language Ecosystem
Memory should not only serve Python developers via `pip install`. Following the rewrite, we officially launched SDKs for the three major languages through Rust's FFI and efficient REST/gRPC interfaces.

---

## 3. Developer Experience: Triple-threat SDKs

Whether you are writing Python AI applications, building AI interaction interfaces with Next.js, or even developing high-performance Rust Agents, EverMemOS integrates seamlessly.

### 🐍 Python SDK
Maintains a minimalist API design tailored to the habits of data scientists and mainstream Agent framework developers.

```python
from evermemos import MemoryClient

client = MemoryClient(api_key="your_key")
# Automatically extract and store MemCell
client.memorize(
    user_id="user_123", 
    content="I have a meeting about Rust performance optimization in Shanghai at 3 PM tomorrow."
)
```

### 📦 TypeScript SDK
Provides full-type asynchronous support for Web and Node.js environments.

```typescript
import { EverMemos } from '@evermemos/sdk-js';

const memos = new EverMemos({ endpoint: 'http://localhost:8080' });
const context = await memos.retrieve({
  userId: 'user_123',
  query: 'What is my schedule for tomorrow?',
  strategy: 'agentic' // Enable intelligent retrieval strategy
});
```

### 🦀 Rust SDK
Provides native `async/await` support and type safety for low-level developers pursuing extreme performance.

```rust
use evermemos_rs_sdk::{Client, RetrievalStrategy};

#[tokio::main]
async fn main() {
    let client = Client::new("http://localhost:8080");
    let results = client.search("user_123")
        .query("Rust performance")
        .strategy(RetrievalStrategy::Hybrid)
        .limit(5)
        .await?;
}
```

---

## 4. Performance Benchmarks

TODO
