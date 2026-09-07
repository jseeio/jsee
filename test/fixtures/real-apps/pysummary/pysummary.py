import micropip
micropip.install('Boruta')

import pandas as pd
import io

DATA = io.StringIO(csv)
df = pd.read_csv(DATA)

res = df.describe().to_dict()
