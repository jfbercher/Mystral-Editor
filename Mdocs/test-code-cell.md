---
python: isolated
---
:::{code-cell}
:packages: numpy

import numpy as np
x = np.linspace(0, 1, 5)
y = x + np.random.randn(len(x))
print(x)
:::
