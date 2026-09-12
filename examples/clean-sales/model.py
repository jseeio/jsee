"""The same sales pipeline using only Python's standard library."""
import csv as csv_lib
import io
import math
import re


def parse_sales(csv):
    reader = csv_lib.reader(io.StringIO(csv.lstrip('\ufeff'), newline=''), strict=True)
    records = [row for row in reader if row]
    columns = records.pop(0) if records else []
    if 'price' not in columns or 'quantity' not in columns or len(set(columns)) != len(columns):
        raise ValueError('CSV needs unique column names including price and quantity')
    if any(len(row) != len(columns) for row in records):
        raise ValueError('CSV rows must have the same number of fields as the header')
    return {'columns': columns, 'rows': records, 'rows_read': len(records)}


async def clean_rows(columns, rows, missing):
    price_index = columns.index('price')
    quantity_index = columns.index('quantity')
    kept, amounts = [], []

    def number(value):
        return (re.fullmatch(r'[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?', value.strip())
                and math.isfinite(float(value)))

    for index, row in enumerate(rows):
        if not row[price_index].strip() and missing == 'drop':
            continue
        if not number(row[price_index]) or not number(row[quantity_index]) or float(row[quantity_index]) < 0:
            raise ValueError('Invalid price or quantity at data row {}'.format(index + 1))
        amount = float(row[price_index]) * float(row[quantity_index])
        if not math.isfinite(amount):
            raise ValueError('Revenue exceeds finite numeric range')
        amounts.append(amount)
        kept.append(row)
    return {'kept': kept, 'amounts': amounts}


def summarize(columns, kept, amounts, rows_read):
    # Accumulate in row order to match the JavaScript model's floating-point operations.
    total_revenue = 0.0
    for amount in amounts:
        total_revenue += amount
    if not math.isfinite(total_revenue):
        raise ValueError('Revenue exceeds finite numeric range')
    def quote(value):
        # Quote both CR and LF even though the artifact uses LF record separators.
        return '"' + value.replace('"', '""') + '"' if any(c in value for c in '\",\r\n') else value

    content = '\n'.join(','.join(quote(value) for value in row) for row in [columns, *kept]) + '\n'
    return {
        'summary': {'rows_read': rows_read, 'rows_kept': len(kept), 'total_revenue': total_revenue},
        'table': {'columns': columns, 'rows': kept},
        'cleaned_csv': {'filename': 'cleaned-sales.csv', 'mime': 'text/csv', 'content': content}
    }
