import io

import pandas as pd


def summarize(csv: str):
    return {'res': pd.read_csv(io.StringIO(csv)).describe().to_dict()}
