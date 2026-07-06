# 公式综合测试文档

本文档包含行内公式、块级公式以及故意错误的公式，
用于验证 RuT0MarkFlow 的 KaTeX 公式渲染与容错能力。

---

## 行内公式

爱因斯坦的质能方程 $E = mc^2$ 是物理学中最著名的公式之一。

二次方程求根公式为 $x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$。

欧拉恒等式 $e^{i\pi} + 1 = 0$ 被誉为最美丽的数学公式。

傅里叶变换 $\hat{f}(\xi) = \int_{-\infty}^{\infty} f(x) e^{-2\pi i x \xi} \,dx$ 在信号处理中广泛应用。

正态分布的概率密度函数是 $f(x) = \frac{1}{\sigma\sqrt{2\pi}} e^{-\frac{1}{2}\left(\frac{x-\mu}{\sigma}\right)^2}$。

## 块级公式

麦克斯韦方程组：

$$
\nabla \cdot \mathbf{E} = \frac{\rho}{\varepsilon_0}
$$

$$
\nabla \cdot \mathbf{B} = 0
$$

$$
\nabla \times \mathbf{E} = -\frac{\partial \mathbf{B}}{\partial t}
$$

$$
\nabla \times \mathbf{B} = \mu_0 \mathbf{J} + \mu_0\varepsilon_0 \frac{\partial \mathbf{E}}{\partial t}
$$

牛顿第二定律：

$$
\mathbf{F} = m \mathbf{a}
$$

拉普拉斯方程：

$$
\nabla^2 \varphi = \frac{\partial^2 \varphi}{\partial x^2} + \frac{\partial^2 \varphi}{\partial y^2} + \frac{\partial^2 \varphi}{\partial z^2} = 0
$$

## 故意错误的公式

以下公式包含语法错误，用于测试渲染器的容错行为：

错误的行内公式： $E = mc^{2$

缺少右花括号的块级公式：

$$
\int_{0}^{\infty} e^{-x^2} \,dx = \frac{\sqrt{\pi}}{2
$$

使用了未定义命令的公式：

$$
\unknowncommand{x}
$$

## 混合段落中的公式

在阅读本文时，请注意公式 $a^2 + b^2 = c^2$ 的渲染效果。
如果是块级公式，它应该独占一行：

$$
\lim_{n \to \infty} \left(1 + \frac{1}{n}\right)^n = e
$$

## 复杂公式

狄拉克符号中的内积表示为 $\langle \psi | \phi \rangle$。

矩阵乘法：

$$
\begin{pmatrix}
a & b \\
c & d
\end{pmatrix}
\begin{pmatrix}
x \\
y
\end{pmatrix}
=
\begin{pmatrix}
ax + by \\
cx + dy
\end{pmatrix}
$$

级数求和：

$$
\sum_{k=1}^{\infty} \frac{1}{k^2} = \frac{\pi^2}{6}
$$

贝叶斯定理：

$$
P(A \mid B) = \frac{P(B \mid A) \, P(A)}{P(B)}
$$

---

以上就是公式验证的全部内容。