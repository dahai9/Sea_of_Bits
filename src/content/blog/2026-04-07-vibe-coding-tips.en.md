---
title: 'Lessons Learned from Implementing a VPS Selling System via Vibe Coding'
description: 'Insights on problem definition and technical principles when using AI for rapid software development.'
pubDate: 'Apr 7 2026'
heroImage: '../../assets/vibe-coding-tips-banner.png'
---

> **Summary**: During "vibe coding," providing vague problems leads to poor model performance. Defining a clear problem is essential for smooth development. When facing unfamiliar technologies, one should prioritize first principles to uncover core mechanics. Only by understanding can you better utilize tools, identify issues, and leverage models for solutions.

---

## 1. How It All Started

I had 13 free promotional VPS instances sitting idle in my repository, each with 1C1G specs. I wanted to put them to use, which sparked the idea for a VPS selling system. With unlimited traffic and decent disk performance across all machines, I thought about using Rust to write a simple selling system that would allow users to purchase these VPS instances and manage them through a web interface. It sounded like a great idea, and so began my "vibe coding" journey.

---

## 2. Defining the Problem

### Pre-Vibe Coding Reflections
Before I started coding, I first needed to define clear problems. I needed a system that allowed users to buy VPS instances and manage them. This system required a web interface where users could see their VPS list, the status of each instance, and perform basic operations like starting, stopping, and rebooting. I also needed a payment system to handle purchases and a ticket system for users to submit requests and for admins to reply. Since I didn't want to deploy this system on a separate server, I had to consider how to deploy it on one of those 1C1G "small potatoes" while ensuring performance and stability.

> **Outcome**: Although I defined a "selling system," I failed to define clear functional requirements—such as what the interface should look like, exactly what features were needed, which payment methods to support, or how the ticket system should function. These remained vague, leading to numerous issues during development, such as irrational UI design and incomplete features. Ultimately, the code generated under `gemini-cli` was essentially just a backend skeleton with no frontend.

### Problem Definition During Vibe Coding

Our goal was to implement full functionality on a 1C1G machine while minimizing resource consumption due to performance constraints. I consulted `gemini 3.1 pro` to understand which database to use for the backend, whether there were existing open-source LXC management platforms, and how to drastically reduce frontend memory usage. Eventually, the following tech stack was chosen:
- **Backend**: axum + sqlx + sqlite
- **Frontend**: dioxus
- **LXC Management**: incus REST API
- **Payment Interface**: PayPal

#### **Defining the Backend**
---
In backend development, many libraries evolve rapidly. A model's training data might not include the latest usage methods for these libraries. We need to define how to find the latest documentation, such as by checking official docs. This allows us to find solutions quickly when encountering problems, rather than being restricted by the model's outdated knowledge, which can lead to redundant loops of incorrect function calls. During this process, you can see the model gradually deviating and suffering from context collapse. **When information is insufficient, one should proactively seek it out. A model's ability to retrieve information weakens as context length increases; much like humans, models can get trapped in fixed mindsets when solving problems. The input the model sees determines the output.**

Since our business logic is common knowledge for the model, we didn't need to define every single detail.

---

#### **Defining the Frontend**

When developing the frontend with non-JS technologies (like Rust), the model has seen fewer examples of web construction. Asking it to build a standard UI without style references resulted in a complete mess. In this scenario, defining the basic layout through an image was the only way to get the frontend development back on track.

---

An `AGENTS.md` file should be used to record the development workflow: how to test, how to verify, and how to find documentation for bleeding-edge libraries. Defining a clear development process makes things much smoother. As the codebase grows, updating `AGENTS.md` helps the model understand the project better. This file is injected into the system prompt; since it exists in every turn of the conversation, it is the first thing the model sees and is almost never forgotten.

## 3. Conclusion

After four days of development, we finally completed the VPS selling system. Although the features are not yet perfect, it already meets basic purchasing and management requirements.

[Project Address](https://github.com/dahai9/cloud-store)
